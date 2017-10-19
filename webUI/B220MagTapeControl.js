/***********************************************************************
* retro-220/webUI B220MagTapeControl.js
************************************************************************
* Copyright (c) 2017, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* Burroughs 220 MagTape Control unit module.
************************************************************************
* 2017-07-09  P.Kimpel
*   Original version, from retro-205 D205MagTapeControl.js.
***********************************************************************/
"use strict";

/**************************************/
function B220MagTapeControl(p) {
    /* Constructor for the MagTapeControl object */
    var left = 0;                       // control window left position
    var top = 412;                      // control window top-from-bottom position
    var u;                              // unit configuration object
    var x;                              // unit index

    this.config = p.config;             // System configuration object
    this.mnemonic = "MCU";
    this.p = p;                         // B220Processor object

    // Do not call this.clear() here -- call this.clearUnit() from onLoad instead

    this.doc = null;
    this.window = window.open("../webUI/B220MagTapeControl.html", this.mnemonic,
            "location=no,scrollbars=no,resizable,width=712,height=144,top=" +
            (screen.availHeight - top) + ",left=" + left);
    this.window.addEventListener("load",
        B220Util.bindMethod(this, B220MagTapeControl.prototype.magTapeOnLoad));

    this.boundControlFinished = B220Util.bindMethod(this, B220MagTapeControl.prototype.controlFinished);
    this.boundTapeUnitFinished = B220Util.bindMethod(this, B220MagTapeControl.prototype.tapeUnitFinished);
    this.boundReadReceiveBlock = B220Util.bindMethod(this, B220MagTapeControl.prototype.readReceiveBlock);
    this.boundWriteTerminate = B220Util.bindMethod(this, B220MagTapeControl.prototype.writeTerminate);
    this.boundWriteSendBlock = B220Util.bindMethod(this, B220MagTapeControl.prototype.writeSendBlock);
    this.boundWriteInitiate = B220Util.bindMethod(this, B220MagTapeControl.prototype.writeInitiate);
    this.boundSearchComplete = B220Util.bindMethod(this, B220MagTapeControl.prototype.searchComplete);

    this.currentUnit = null;            // stashed tape unit object
    this.memoryBlockCallback = null;    // stashed block-sending/receiving call-back function
    this.memoryTerminateCallback = null;// stashed memory-sending terminate call-back function
    this.tapeBlock = new Float64Array(101);
                                        // block buffer for tape I/O

    /* Set up the tape units from the system configuration. These can be any
    combination of Tape Storage Units (DataReaders) and DataFiles. The indexes
    into this array are physical unit numbers used internally -- unit designate
    is set on the tape unit itself */

    this.tapeUnit = [
            null,                       // 0=not used
            null,                       // tape unit A
            null,                       // tape unit B
            null,                       // tape unit C
            null,                       // tape unit D
            null,                       // tape unit E
            null,                       // tape unit F
            null,                       // tape unit G
            null,                       // tape unit H
            null,                       // tape unit I
            null];                      // tape unit J

    for (x=1; x<this.tapeUnit.length; ++x) {
        u = this.config.getNode("MagTape.units", x);
        switch (u.type.substring(0, 2)) {
        case "MT":
            this.tapeUnit[x] = new B220MagTapeDrive(u.type, x, this.config);
            break;
        case "DF":
            this.tapeUnit[x] = new B220DataFile(u.type, x, this.config);
            break;
        default:
            this.tapeUnit[x] = null;
            break;
        } // switch u.type
    } // for x
}

/**************************************/
B220MagTapeControl.prototype.$$ = function $$(e) {
    return this.doc.getElementById(e);
};

/**************************************/
B220MagTapeControl.prototype.clear = function clear() {
    /* Initializes (and if necessary, creates) the panel state */

    this.MISC = 0;                      // Miscellaneous control register
    this.C = 0;                         // C register (block number, etc.)
    this.T = 0;                         // T register

    this.unitNr = 0;                    // current unit number from command
    this.unitIndex = 0;                 // current index into this.tapeUnit[]
    this.blockCount = 0;                // number of blocks for current operation
    this.blockWords = 0;                // number of words/block for current operation

    this.controlBusy = false;           // control unit is busy with read/write/search
    this.pendingCallee = null;          // method to call for a pending operation
    this.pendingArgs = null;            // Arguments object for a pending operation
};

/**************************************/
B220MagTapeControl.prototype.findDesignate = function findDesignate(u) {
    /* Searches this.tapeUnit[] to find the internal index of the unit that is
    designated as "u". If found, returns the internal index; if not found,
    returns -1. If more than one ready unit with the same designate is found,
    returns -2 */
    var index = -1;
    var unit;
    var x;

    for (x=this.tapeUnit.length-1; x>=0; --x) {
        unit = this.tapeUnit[x];
        if (unit && unit.ready) {
            if (unit.unitDesignate == u) {
                if (index == -1) {
                    index = x;
                } else {
                    index = -2;
                    break;              // out of for loop
                }
            }
        }
    } // for x

    return index;
};

/**************************************/
B220MagTapeControl.prototype.queuePendingOperation = function queuePendingOperation(callee, args) {
    /* Queues a pending tape operation */

    //console.log(this.mnemonic + " queuePendingOperation: " + args[0].toString(16));
    if (this.pendingCallee !== null) {
        throw new Error("More than one pending tape control operation");
    }

    this.pendingCallee = callee;
    this.pendingArgs = args;
};

/**************************************/
B220MagTapeControl.prototype.loadCommand = function loadCommand(dReg, releaseProcessor, callee, args) {
    /* If the control unit or the tape unit addressed by the unit field in dReg
    are currently busy, queues the args parameter (an Arguments object) in
    this.pendingCallee and -Args, and returns false. If the control is idle but
    the tape unit is not ready or not present, or two units have the same designate,
    calls the releaseProcessor call-back and returns false. If the control and
    tape unit are ready for their next operation, loads the contents of the processor's
    D register passed to the operation routines into the T, C, and MISC registers.
    Sets this.unitNr, this.unitIndex, this.blockCount, and this.blockWords from
    the digits in T. Then returns true */
    var c;                              // scratch
    var t = dReg%0x10000000000;         // scratch
    var ux;                             // internal unit index
    var result = false;                 // return value

    //console.log(this.mnemonic + " loadCommand: " + dReg.toString(16));
    if (this.controlBusy) {
        this.queuePendingOperation(callee, args);
    } else {
        this.MISC = 0;
        this.T = t;
        this.unitNr = (t - t%0x1000000000)/0x1000000000;
        t = (t - t%0x10000)/0x10000;
        c = t%0x10;                     // low-order digit of op code
        t = (t - t%0x100)/0x100;        // control digits from instruction
        this.blockWords = t%0x100;
        this.blockCount = ((t - this.blockWords)/0x100)%0x10;
        if (this.blockWords == 0) {
            this.blockWords = 100;
        } else {
            this.blockWords = B220Processor.bcdBinary(this.blockWords);
        }

        this.C = this.unitNr*0x100000 + t*0x10 + c;
        this.regMisc.update(this.MISC);
        this.regC.update(this.C);
        this.regT.update(this.T);
        this.unitIndex = ux = this.findDesignate(this.unitNr);
        if (ux < 0) {
            setCallback(this.mnemonic, this, 0, releaseProcessor, true);
        } else if (this.tapeUnit[ux].busy) {
            this.queuePendingOperation(callee, args);
        } else {
            result = true;
        }
    }

    return result;
};

/**************************************/
B220MagTapeControl.prototype.controlFinished = function controlFinished(alarm) {
    /* Releases the busy status of the control. Typically used as a timed call-
    back to simulate the amount of time the control unit is busy with an I/O.
    If alarm is true, sets the Processor's Magnetic Tape Check alarm.
    If another operation is pending, initiates that operation */
    var args;                           // pending Arguments object
    var callee;                         // pending method to call

    //console.log(this.mnemonic + " controlFinished: " + alarm + ", busy=" + this.controlBusy);
    if (alarm) {
        this.p.setMagneticTapeCheck(true);
    }

    this.controlBusy = false;
    if (this.pendingCallee !== null) {
        callee = this.pendingCallee;
        args = this.pendingArgs;
        this.pendingCallee = this.pendingArgs = null;
        callee.apply(this, args);
    }
};

/**************************************/
B220MagTapeControl.prototype.tapeUnitFinished = function tapeUnitFinished(alarm) {
    /* Call-back function passed to tape unit methods to signal when the unit has
    completed its asynchronous operation */

    if (!this.controlBusy) {            // if the control unit is currently idle...
        this.controlFinished(alarm);    // initiate any pending operation
    }
};

/**************************************/
B220MagTapeControl.prototype.decrementBlockCount = function decrementBlockCount() {
    /* Decrements the block-count digit in the C register. Returns true if the
    remaining block count is non-zero, false otherwise */
    var c1 = this.C;                    // will hold two high-order digits of C: uu0000
    var c2 = c1%0x10000;                // four low-order digits of C: bddd, b=block count
    var result = true;

    c1 -= c2;
    if (c2 < 0x1000) {
        c2 += 0x9000;                   // decrement 0x0ddd to 0x9ddd as count=0 => 10
    } else {
        c2 -= 0x1000;                   // decrement 0xddd..0x9ddd
        if (c2 < 0x1000) {
            result = false;             // decremented 0x1ddd to 0x0ddd: no more blocks
        }
    }

    this.C = c1+c2;
    this.regC.update(this.C);
    return result;
};

/**************************************/
B220MagTapeControl.prototype.ClearBtn_onClick = function ClearBtn_onClick(ev) {
    /* Handle the click event for the tape control CLEAR button */

    this.clearUnit();
};

/**************************************/
B220MagTapeControl.prototype.beforeUnload = function beforeUnload(ev) {
    var msg = "Closing this window will make the panel unusable.\n" +
              "Suggest you stay on the page and minimize this window instead";

    ev.preventDefault();
    ev.returnValue = msg;
    return msg;
};

/**************************************/
B220MagTapeControl.prototype.magTapeOnLoad = function magTapeOnLoad() {
    /* Initializes the MagTape Control window and user interface */
    var body;
    var box;
    var e;
    var x;

    this.doc = this.window.document;
    body = this.$$("PanelSurface");

    // Misc Register
    this.regMisc = new PanelRegister(this.$$("MiscRegPanel"), 4*4, 4, "Misc_", " ");
    this.regMisc.lamps[15].setCaption("MCL", true);
    this.regMisc.lamps[14].setCaption("MC6", true);
    this.TYC1Lamp = this.regMisc.lamps[13];
    this.TYC1Lamp.setCaption("TYC", true);
    this.TYC2Lamp = this.regMisc.lamps[12];
    this.TYC2Lamp.setCaption("TYC", true);
    this.TCFLamp = this.regMisc.lamps[10];      // not in this physical position on a 220
    this.TCFLamp.setCaption("TCF", true);
    this.TPCLamp = this.regMisc.lamps[7];
    this.TPCLamp.setCaption("TPC", true);
    this.regMisc.lamps[6].setCaption("TSX", true);
    this.regMisc.lamps[5].setCaption("1R6", true);
    this.TX1Lamp = this.regMisc.lamps[4];
    this.TX1Lamp.setCaption("TX1", true);
    this.TX10Lamp = this.regMisc.lamps[3];
    this.TX10Lamp.setCaption("TX10", true);
    this.TX8Lamp = this.regMisc.lamps[2];
    this.TX8Lamp.setCaption("TX8", true);
    this.TX4Lamp = this.regMisc.lamps[1];
    this.TX4Lamp.setCaption("TX4", true);
    this.TX2Lamp = this.regMisc.lamps[0];
    this.TX2Lamp.setCaption("TX2", true);

    // C Register
    this.regC = new PanelRegister(this.$$("CRegPanel"), 6*4, 4, "C_", "C");

    // T Register
    this.regT = new PanelRegister(this.$$("TRegPanel"), 10*4, 4, "T_", "T");


    // Events

    this.window.addEventListener("beforeunload", B220MagTapeControl.prototype.beforeUnload);
    this.$$("ClearBtn").addEventListener("click",
            B220Util.bindMethod(this, B220MagTapeControl.prototype.ClearBtn_onClick));

    this.clearUnit();
};

/**************************************/
B220MagTapeControl.prototype.readTerminate = function readTerminate() {
    /* Terminates the read operation, sets the control to not-busy, and signals
    the processor we are finished with the I/O */

    this.controlBusy = false;
    this.currentUnit.readTerminate();
};

/**************************************/
B220MagTapeControl.prototype.readReceiveBlock = function readReceiveBlock(block, abortRead) {
    /* Receives the next block read by the tape unit. Sends the block to the
    processor for storage in memory, updates the block counter, and if not
    finished, requests the next block from the tape. Termination is a little
    tricky here, as readTerminate() must be called to release the drive before
    the block is stored in memory (and p.executeComplete() called to advance to
    the next instruction, but if the memory call-back tells us the processor
    has been cleared, we must release the drive after the attempt to store the
    block in memory. Mess with the sequencing below at your peril */
    var lastBlock;
    var t = B220Processor.bcdBinary(this.T);

    if (abortRead) {
        this.readTerminate();
        this.memoryBlockCallback(null, true);
    } else {
        // Decrement the block counter in the T register:
        t = (t + 990)%1000;                 // subtract 1 from the counter field without overflow
        this.T = B220Processor.binaryBCD(t);
        this.regT.update(this.T);

        // If there are more blocks to read, request the next one
        lastBlock = (t < 10);
        if (lastBlock) {
            this.readTerminate();
            abortRead = this.memoryBlockCallback(block, true);
        } else {
            abortRead = this.memoryBlockCallback(block, false);
            if (abortRead) {            // processor was cleared
                this.readTerminate();
            } else {                    // at least one block left to go
                this.currentUnit.readBlock(this.boundReadReceiveBlock);
            }
        }
    }
};

/**************************************/
B220MagTapeControl.prototype.read = function read(unitNr, blocks, blockSender) {
    /* Initiates a read on the designated unit. "blocks" is the number of blocks
    to read in BCD; "blockSender" is the call-back function to send a block of data
    to the processor. "terminator" is the call-back function to tell the Processor
    the I/O is finished. Returns true if the control is still busy with another command
    or the unit is busy, and does not do the read */
    var result = false;                 // return value
    var unit;                           // tape unit object
    var ux;                             // internal unit index

    if (this.controlBusy) {
        result = true;
    } else {
        this.C = unitNr;
        this.regC.update(unitNr);
        ux = this.findDesignate(unitNr);
        if (ux < 0) {
            result = true;
        } else {
            this.controlBusy = true;
            this.currentUnit = unit = this.tapeUnit[ux];
            this.MISC = B220Processor.binaryBCD(unit.laneNr);
            this.regMisc.update(this.MISC);
            this.T = blocks*0x10 + unitNr;
            this.regT.update(this.T);
            this.memoryBlockCallback = blockSender;
            result = unit.readInitiate(this.boundReadReceiveBlock);
            if (result) {
                this.controlBusy = false;
            }
        }
    }

    return result;
};

/**************************************/
B220MagTapeControl.prototype.writeTerminate = function writeTerminate(abortWrite) {
    /* Called by the drive after the last block is written to release the
    control unit and terminate the I/O. Note that "abortWrite" is not used, but
    exists for signature compatibility with writeSendBlock() */

    this.recordLamp.set(0);
    this.controlBusy = false;
    this.memoryTerminateCallback();
};

/**************************************/
B220MagTapeControl.prototype.writeSendBlock = function writeSendBlock(abortWrite) {
    /* Called by the tape drive when it is ready for the next block to be written.
    Retrieves the next buffered block from the Processor and passes it to the drive.
    Unless this is the last block to write, the drive will call this again after
    tape motion is complete. Note that this.memoryBlockCallback() will return true
    if the processor has been cleared and the I/O must be aborted */
    var aborted;                        // true if processor aborted the I/O
    var lastBlock = abortWrite;         // true if this will be the last block
    var t = B220Processor.bcdBinary(this.T);

    // First, decrement the block counter in the T register:
    t = (t + 990)%1000;                 // subtract 1 from the counter field without overflow
    this.T = B220Processor.binaryBCD(t);
    this.regT.update(this.T);
    if (t < 10) {
        lastBlock = true;
    }

    aborted = this.memoryBlockCallback(this.tapeBlock, lastBlock);
    if (abortWrite || aborted) {
        this.writeTerminate(false);
    } else if (lastBlock) {
        this.currentUnit.writeBlock(this.tapeBlock, this.boundWriteTerminate, true);
    } else {
        this.currentUnit.writeBlock(this.tapeBlock, this.boundWriteSendBlock, false);
    }
};

/**************************************/
B220MagTapeControl.prototype.writeInitiate = function writeInitiate(blockReceiver, terminator) {
    /* Call-back function called by the Processor once the initial block to be
    written is buffered in one of the high-speed loops. Once this block is
    buffered, the drive can start tape motion and begin writing to tape */

    this.memoryBlockCallback = blockReceiver;
    this.memoryTerminateCallback = terminator;
    this.currentUnit.writeInitiate(this.boundWriteSendBlock);
};

/**************************************/
B220MagTapeControl.prototype.write = function write(unitNr, blocks, receiveInitiate) {
    /* Initiates a write on the designated unit. "blocks" is the number of blocks
    to write in BCD; "receiveInitiate" is the call-back function to begin memory
    transfer from the processor. Returns true if the control is still busy with
    another command or the unit is busy, and does not do the write */
    var result = false;                 // return value
    var unit;                           // tape unit object
    var ux;                             // internal unit index

    if (this.controlBusy) {
        result = true;
    } else {
        this.C = unitNr;
        this.regC.update(unitNr);
        ux = this.findDesignate(unitNr);
        if (ux < 0) {
            result = true;
        } else {
            this.controlBusy = true;
            this.currentUnit = unit = this.tapeUnit[ux];
            this.MISC = B220Processor.binaryBCD(unit.laneNr);
            this.regMisc.update(this.MISC);
            this.T = blocks*0x10 + unitNr;
            this.regT.update(this.T);
            result = unit.writeReadyTest();
            if (result) {
                this.controlBusy = false;
            } else {
                receiveInitiate(this.boundWriteInitiate);
            }
        }
    }

    return result;
};

/**************************************/
B220MagTapeControl.prototype.searchComplete = function searchComplete(success) {
    /* Resets the busy status at the completion of a search */
    var d;                              // scratch digit

    if (success) {
        // rotate T one digit right at end of successful search
        d = this.T % 0x10;
        this.T = d*0x1000 + (this.T - d)/0x10;
        this.regT.update(this.T);
    }

    this.controlBusy = false;
};

/**************************************/
B220MagTapeControl.prototype.search = function search(unitNr, laneNr, addr) {
    /* Initiates a search on the designated unit. "laneNr" is the lane number in
    BCD; "addr" is the number of the block to search for in BCD. The search
    Takes place in the control unit and drive independently of the processor.
    Returns true if the control is still busy with another command or the unit
    is busy, and does not do the search */
    var block = B220Processor.bcdBinary(addr);
    var lane = B220Processor.bcdBinary(laneNr);
    var result = false;                 // return value
    var unit;                           // tape unit object
    var ux;                             // internal unit index

    if (this.controlBusy) {
        result = true;
    } else {
        this.C = unitNr;
        this.regC.update(unitNr);
        this.MISC = laneNr;
        this.regMisc.update(laneNr);
        this.T = addr;
        this.regT.update(addr);
        ux = this.findDesignate(unitNr);
        if (ux < 0) {
            result = true;
        } else {
            this.controlBusy = true;
            unit = this.tapeUnit[ux];
            result = unit.search(lane, block, this.boundSearchComplete,
                    this.boundDirectionLampSet, this.boundTestDisabled);
            if (result) {
                this.controlBusy = false;
            }
        }
    }

    return result;
};

/**************************************/
B220MagTapeControl.prototype.initialWrite = function initialWrite(dReg, releaseProcessor, fetchBlock) {
    /* Initial-writes the number of blocks and of the size indicated in dReg.
    This routine is used by MIW */
    var alarm = false;                  // error result
    var blocksLeft = true;              // true => more blocks to process
    var that = this;                    // local self-reference
    var unit = null;                    // selected tape unit

    function blockReady(alarm, writeBlock, completed) {
        /* Call-back function when the drive is ready to receive the next block
        of data, or when it has encountered an error such as EOT. If there are
        more blocks to write, fetches the next block from the Processor and calls
        the drive's "writeBlock" function, otherwise calls "completed" to finish
        the operation */

        if (alarm) {
            setCallback(that.mnemonic, that, 0, releaseProcessor, true);
            completed(true);            // drive detected an error
        } else if (blocksLeft) {
            blocksLeft = that.decrementBlockCount();    // set to false on last block
            if (that.blockWords < unit.minBlockWords && that.blockWords > 1) {
                completed(true);        // invalid block size
            } else if (fetchBlock(that.tapeBlock, that.blockWords)) {
                completed(true);        // Processor cleared or memory address error
            } else {
                writeBlock(that.tapeBlock, that.blockWords); // write next block
            }
        } else {
            setCallback(that.mnemonic, that, 0, releaseProcessor, false);
            completed(false);           // normal termination
        }
    }

    if (this.loadCommand(dReg, releaseProcessor, initialWrite, arguments)) {
        this.controlBusy = true;
        unit = this.tapeUnit[this.unitIndex];
        alarm = unit.initialWriteBlock(blockReady, this.boundControlFinished);
        if (alarm) {
            setCallback(this.mnemonic, this,  0, releaseProcessor, alarm);
            controlFinished(true);
        }
    }
};

/**************************************/
B220MagTapeControl.prototype.initialWriteRecord = function initialWriteRecord(dReg, releaseProcessor, fetchBlock) {
    /* Initial-writes the number of blocks indicated in dReg. Block lengths
    (preface words) are taken from the word in memory preceding the data to be
    written. This routine is used by MIR */
    var alarm = false;                  // error result
    var blocksLeft = true;              // true => more blocks to process
    var that = this;                    // local self-reference
    var unit = null;                    // selected tape unit

    function blockReady(alarm, writeBlock, completed) {
        /* Call-back function when the drive is ready to receive the next block
        of data, or when it has encountered an error such as EOT. If there are
        more blocks to write, fetches the next block and its size from the
        Processor and calls the drive's "writeBlock" function, otherwise calls
        "completed" to finish the operation */
        var words;                      // words to write for block

        if (alarm) {
            setCallback(that.mnemonic, that, 0, releaseProcessor, true);
            completed(true);            // drive detected an error
        } else if (blocksLeft) {
            blocksLeft = that.decrementBlockCount();    // set to false on last block
            if (fetchBlock(that.tapeBlock, 1)) {        // fetch the preface word
                completed(true);        // Processor cleared or memory address error
            } else {
                words = that.tapeBlock[0];              // convert preface to binary
                words = ((words - words%0x100000000)/0x100000000)%0x100;
                if (words) {
                    words = (words >>> 4)*10 + words%0x10;
                } else {
                    words = 100;        // preface == 0 => 100
                }

                if (words < unit.minBlockWords && words > 1) {
                    completed(true);    // invalid block size
                } else if (fetchBlock(that.tapeBlock, words)) {
                    completed(true);    // Processor cleared or memory address error
                } else {
                    writeBlock(that.tapeBlock, words); // write next block
                }
            }
        } else {
            setCallback(that.mnemonic, that, 0, releaseProcessor, false);
            completed(false);           // normal termination
        }
    }

    if (this.loadCommand(dReg, releaseProcessor, initialWriteRecord, arguments)) {
        this.controlBusy = true;
        unit = this.tapeUnit[this.unitIndex];
        alarm = unit.initialWriteBlock(blockReady, this.boundControlFinished);
        if (alarm) {
            setCallback(this.mnemonic, this,  0, releaseProcessor, alarm);
            controlFinished(true);
        }
    }
};

/**************************************/
B220MagTapeControl.prototype.positionForward = function positionForward(dReg, releaseProcessor) {
    /* Positions the tape forward the number of blocks indicated in dReg */
    var alarm = false;                  // error result
    var that = this;                    // local self-reference
    var unit = null;                    // selected tape unit

    function blockFinished(nextBlock, completed) {
        /* Call-back function when the drive has finished spacing one block
        forward. If there are more blocks to space, calls "nextBlock", otherwise
        calls "completed" to finish the operation */

        if (that.decrementBlockCount()) {
            nextBlock(blockFinished);
        } else {
            completed(false);
        }
    }

    if (this.loadCommand(dReg, releaseProcessor, positionForward, arguments)) {
        this.controlBusy = true;
        unit = this.tapeUnit[this.unitIndex];
        alarm = unit.positionForward(blockFinished, this.boundControlFinished);
        setCallback(this.mnemonic, this,  0, releaseProcessor, alarm);
    }
};

/**************************************/
B220MagTapeControl.prototype.positionBackward = function positionBackward(dReg, releaseProcessor) {
    /* Positions the tape backward the number of blocks indicated in dReg */
    var alarm = false;                  // error result
    var that = this;                    // local self-reference
    var unit = null;                    // selected tape unit

    function blockFinished(nextBlock, completed) {
        /* Call-back function when the drive has finished spacing one block
        backward. If there are more blocks to space, calls "nextBlock", otherwise
        calls "completed" to finish the operation */

        if (that.decrementBlockCount()) {
            nextBlock(blockFinished);
        } else {
            completed(false);
        }
    }

    if (this.loadCommand(dReg, releaseProcessor, positionBackward, arguments)) {
        this.controlBusy = true;
        unit = this.tapeUnit[this.unitIndex];
        alarm = unit.positionBackward(blockFinished, this.boundControlFinished);
        setCallback(this.mnemonic, this,  0, releaseProcessor, alarm);
    }
};

/**************************************/
B220MagTapeControl.prototype.positionAtEnd = function positionAtEnd(dReg, releaseProcessor) {
    /* Positions the tape to the end of recorded information (i.e., when a gap
    longer than inter-block gap is detected. Leaves the tape at the end of the
    prior recorded block */
    var alarm = false;                  // error result

    if (this.loadCommand(dReg, releaseProcessor, positionAtEnd, arguments)) {
        this.controlBusy = true;
        alarm = this.tapeUnit[this.unitIndex].positionAtEnd(this.boundControlFinished);
        setCallback(this.mnemonic, this,  0, releaseProcessor, alarm);
    }
};

/**************************************/
B220MagTapeControl.prototype.laneSelect = function laneSelect(dReg, releaseProcessor) {
    /* Selects the tape lane of the designated unit. Returns an alarm if the
    unit does not exist or is not ready */
    var alarm = false;                  // error result
    var laneNr;                         // lane to select (0, 1)

    if (this.loadCommand(dReg, releaseProcessor,laneSelect, arguments)) {
        this.controlBusy = true;
        laneNr = ((this.C - this.C%0x100)/0x100)%2;
        alarm = this.tapeUnit[this.unitIndex].laneSelect(laneNr, this.boundControlFinished);
        setCallback(this.mnemonic, this,  0, releaseProcessor, alarm);
    }
};

/**************************************/
B220MagTapeControl.prototype.rewind = function rewind(dReg, releaseProcessor) {
    /* Initiates rewind of the designated unit. Returns an alarm if the unit
    does not exist or is not ready */
    var alarm = false;                  // error result
    var laneNr;                         // lane to select (0, 1)
    var lockout;                        // lockout after rewind  (0, 1)

    if (this.loadCommand(dReg, releaseProcessor, rewind, arguments)) {
        this.controlBusy = true;
        laneNr = ((this.C - this.C%0x100)/0x100)%2;
        lockout = ((this.C - this.C%0x10)/0x10)%2;
        alarm = this.tapeUnit[this.unitIndex].rewind(laneNr, lockout, this.boundTapeUnitFinished);
        setCallback(this.mnemonic, this, 50, this.controlFinished, false);
        setCallback(this.mnemonic, this,  0, releaseProcessor, alarm);
    }
};

/**************************************/
B220MagTapeControl.prototype.testUnitReady = function testUnitReady(dReg) {
    /* Interrogates status of the designated unit. Returns true if ready */
    var result = false;                 // return value
    var ux;                             // internal unit index

    ux = ((dReg - dReg%0x1000000000)/0x1000000000)%0x10;
    ux = this.findDesignate(ux);
    if (ux >= 0) {
        if (this.tapeUnit[ux].ready) {
            if (!this.tapeUnit[ux].busy) {
                result = true;
            }
        }
    }

    return result;
};

/**************************************/
B220MagTapeControl.prototype.testUnitAtMagneticEOT = function testUnitAtMagneticEOT(dReg) {
    /* Interrogates status of the designated unit. Returns true if ready and at
    Magnetic-End-of-Tape */
    var result = false;                 // return value
    var ux;                             // internal unit index

    ux = ((dReg - dReg%0x1000000000)/0x1000000000)%0x10;
    ux = this.findDesignate(ux);
    if (ux >= 0) {
        if (this.tapeUnit[ux].ready) {
            if (this.tapeUnit[ux].atEOT) {
                result = true;
            }
        }
    }

    return result;
};

/**************************************/
B220MagTapeControl.prototype.clearUnit = function clearUnit() {
    /* Clears the internal state of the control unit */

    this.clear();
    this.regMisc.update(this.MISC);
    this.regC.update(this.C);
    this.regT.update(this.T);
};

/**************************************/
B220MagTapeControl.prototype.shutDown = function shutDown() {
    /* Shuts down the panel */
    var x;

    if (this.tapeUnit) {
        for (x=this.tapeUnit.length-1; x>=0; --x) {
            if (this.tapeUnit[x]) {
                this.tapeUnit[x].shutDown();
                this.tapeUnit[x] = null;
            }
        }
    }

    this.window.removeEventListener("beforeunload", B220MagTapeControl.prototype.beforeUnload);
    this.window.close();
};