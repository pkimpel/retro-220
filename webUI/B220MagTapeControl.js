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
    this.boundSwitch_Click = B220Util.bindMethod(this, B220MagTapeControl.prototype.switch_Click);

    this.currentUnit = null;            // stashed tape unit object

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
            this.tapeUnit[x] = new B220MagTapeDrive(u.type, x, this, this.config);
            break;
        case "DF":
            this.tapeUnit[x] = new B220DataFile(u.type, x, this, this.config);
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

    this.C = 0;                         // C register (unit, block count, etc.)
    this.T = 0;                         // T register

    this.unitNr = 0;                    // current unit number from command
    this.unitIndex = 0;                 // current index into this.tapeUnit[]
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
B220MagTapeControl.prototype.dequeuePendingOperation = function dequeuePendingOperation() {
    /* Dequeues and reinitiates a pending tape operation */
    var args = this.pendingArgs;        // pending Arguments object
    var callee = this.pendingCallee;    // pending method to call

    this.pendingCallee = this.pendingArgs = null;
    callee.apply(this, args);
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
    Sets this.unitNr, this.unitIndex, and this.blockWords from the digits in T.
    Sets this.currentUnit to the current tape unit object. Then returns true */
    var c;                              // scratch
    var t = dReg%0x10000000000;         // scratch
    var ux;                             // internal unit index
    var result = false;                 // return value

    //console.log(this.mnemonic + " loadCommand: " + dReg.toString(16));
    if (this.controlBusy) {
        this.queuePendingOperation(callee, args);
    } else {
        this.T = t;
        this.unitNr = (t - t%0x1000000000)/0x1000000000;
        t = (t - t%0x10000)/0x10000;
        c = t%0x10;                     // low-order digit of op code
        t = (t - t%0x100)/0x100;        // control digits from instruction
        this.blockWords = t%0x100;
        if (this.blockWords > 0) {
            this.blockWords = B220Processor.bcdBinary(this.blockWords);
        } else {
            this.blockWords = 100;
        }

        this.C = this.unitNr*0x100000 + t*0x10 + c;
        this.clearMisc();
        this.regC.update(this.C);
        this.regT.update(this.T);
        this.unitIndex = ux = this.findDesignate(this.unitNr);
        if (ux < 0) {
            this.reportStatus(2);       // drive not ready, not present
            setCallback(this.mnemonic, this, 0, releaseProcessor, true);
        } else {
            this.currentUnit = this.tapeUnit[ux];
            if (this.currentUnit.busy || this.currentUnit.rewindLock) {
                this.queuePendingOperation(callee, args);
            } else {
                result = true;
            }
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

    //console.log(this.mnemonic + " controlFinished: " + alarm + ", busy=" + this.controlBusy);
    if (alarm) {
        this.p.setMagneticTapeCheck(true);
    }

    this.controlBusy = false;
    if (this.pendingCallee !== null) {
        this.dequeuePendingOperation();
    }
};

/**************************************/
B220MagTapeControl.prototype.tapeUnitFinished = function tapeUnitFinished() {
    /* Call-back function passed to tape unit methods to signal when the unit has
    completed its asynchronous operation */

    if (!this.controlBusy) {            // if the control unit is currently idle...
        if (this.pendingCallee !== null) {
            this.dequeuePendingOperation();
        }
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
B220MagTapeControl.prototype.clearMisc = function clearMisc() {
    /* Resets this.regMisc and the individual lamps for that register */
    var bitNr;
    var m = this.regMisc;

    m.update(0);
    for (bitNr=m.bits-1; bitNr>= 0; --bitNr) {
        m.lamps[bitNr].set(0);
    }
};

/**************************************/
B220MagTapeControl.prototype.reportStatus = function reportStatus(code) {
    /* Sets bits in the MISC register to indicate various drive and control unit
    status and error conditions */

    switch (code) {
    case 1: // report tape unit ready
        this.TX2Lamp.set(0);
        this.TX10Lamp.set(0);
        break;
    case 2: // report tape unit not ready
        this.TX2Lamp.set(1);
        this.TX10Lamp.set(1);
        break;
    case 4: // read check
        this.TYC1Lamp.set(1);
        this.TYC2Lamp.set(1);
        break;
    } // switch code
};

/**************************************/
B220MagTapeControl.prototype.switch_Click = function switch_Click(ev) {
    /* Handle the click event for buttons and switches */

    switch(ev.target.id) {
    case "ClearBtn":
        this.clearUnit();
        break;
    case "Misc_RightClear":
        this.clearMisc();
        break;
    case "C_RightClear":
        this.C = 0;
        this.regC.update(0);
        break;
    case "T_RightClear":
        this.T = 0;
        this.regT.update(0);
        break;
    } // switch target.id
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

    // Full Registers
    this.regC = new PanelRegister(this.$$("CRegPanel"),  6*4, 4, "C_", "C");
    this.regT = new PanelRegister(this.$$("TRegPanel"), 10*4, 4, "T_", "T");


    // Events
    this.window.addEventListener("beforeunload", B220MagTapeControl.prototype.beforeUnload);
    this.$$("ClearBtn").addEventListener("click", this.boundSwitch_Click, false);
    this.regMisc.rightClearBar.addEventListener("click", this.boundSwitch_Click, false);
    this.regC.rightClearBar.addEventListener("click", this.boundSwitch_Click, false);
    this.regT.rightClearBar.addEventListener("click", this.boundSwitch_Click, false);

    this.clearUnit();
};

/**************************************/
B220MagTapeControl.prototype.search = function search(dReg, releaseProcessor, bReg, fetchWord) {
    /* Searches a tape unit for a block with a keyWord matching the word at the
    operand address in memory. "bReg is the contents of the B register for a
    search, or 0 for a full-word search. This routine is used by MTS and MFS */
    var alarm = false;                  // error result
    var blocksLeft = true;              // true => more blocks to process
    var searchWord;                     // target word to search for
    var that = this;                    // local self-reference

    function signalControl(controlWord) {
        /* Call-back function to send the EOT or control word to the Processor
        and release it for the next operation */

        releaseProcessor(false, true, controlWord);
    }

    function blockReady(alarm, control, controlWord, readBlock, completed) {
        /* Call-back function when the drive is ready to send the next block
        of data, or when it has encountered an error such as EOT. "alarm"
        indicates that an error has occurred and the operation is to be aborted.
        "control" inidicates that an EOT or control block was encountered, and
        "controlWord" is to be passed to the Processor for handling. Otherwise,
        if there are more blocks to write, fetches the next block from the
        Processor and calls the drive's "readBlock" function, Finally calls
        "completed" to finish the operation */

        if (alarm) {
            setCallback(that.mnemonic, that, 0, releaseProcessor, true);
            completed(true);            // drive detected an error
        } else if (control) {
            setCallback(that.mnemonic, that, 0, signalControl, controlWord);
            completed(false);
        } else if (blocksLeft) {
            blocksLeft = that.decrementBlockCount();    // set to false on last block
            readBlock(storeWord, record, controlEnabled);// read the next block
        } else {
            setCallback(that.mnemonic, that, 0, releaseProcessor, false);
            completed(false);           // normal termination
        }
    }

    if (this.loadCommand(dReg, releaseProcessor, search, arguments)) {
        this.controlBusy = true;
        searchWord = fetchWord(true);
        if (searchWord < 0) {
            alarm = true;
        } else {
            alarm = this.currentUnit.searchBlock(blockReady, this.boundControlFinished);
        }

        if (alarm) {
            setCallback(this.mnemonic, this,  0, releaseProcessor, alarm);
            this.controlFinished(true);
        }
    }
};

/**************************************/
B220MagTapeControl.prototype.read = function read(dReg, releaseProcessor, record, storeWord) {
    /* Reads the number of blocks indicated in dReg. If "record" is true (MRR),
    block lengths (preface words) are stored into the word in memory preceding
    the data read from tape. "storeWord" is a function to store a word to the
    Processor's memory. This routine is used by MRD and MRR */
    var alarm = false;                  // error result
    var blocksLeft = true;              // true => more blocks to process
    var controlEnabled = false;         // true => control blocks will be recognized
    var that = this;                    // local self-reference

    function signalControl(controlWord) {
        /* Call-back function to send the EOT or control word to the Processor
        and release it for the next operation */

        releaseProcessor(false, true, controlWord);
    }

    function blockReady(alarm, control, controlWord, readBlock, completed) {
        /* Call-back function when the drive is ready to send the next block
        of data, or when it has encountered an error such as EOT. "alarm"
        indicates that an error has occurred and the operation is to be aborted.
        "control" inidicates that an EOT or control block was encountered, and
        "controlWord" is to be passed to the Processor for handling. Otherwise,
        if there are more blocks to write, fetches the next block from the
        Processor and calls the drive's "readBlock" function, Finally calls
        "completed" to finish the operation */

        if (alarm) {
            setCallback(that.mnemonic, that, 0, releaseProcessor, true);
            completed(true);            // drive detected an error
        } else if (control) {
            setCallback(that.mnemonic, that, 0, signalControl, controlWord);
            completed(false);
        } else if (blocksLeft) {
            blocksLeft = that.decrementBlockCount();    // set to false on last block
            readBlock(storeWord, record, controlEnabled);// read the next block
        } else {
            setCallback(that.mnemonic, that, 0, releaseProcessor, false);
            completed(false);           // normal termination
        }
    }

    if (this.loadCommand(dReg, releaseProcessor, read, arguments)) {
        this.controlBusy = true;
        controlEnabled = (this.blockWords%2 == 0);      // low-order bit of v-digit
        alarm = this.currentUnit.readBlock(blockReady, this.boundControlFinished);
        if (alarm) {
            setCallback(this.mnemonic, this,  0, releaseProcessor, alarm);
            this.controlFinished(true);
        }
    }
};

/**************************************/
B220MagTapeControl.prototype.overwrite = function overwrite(dReg, releaseProcessor, record, fetchWord) {
    /* Overwrites the number of blocks and of the size indicated in dReg. If
    "record" is true (MOR), block lengths (preface words) are taken from the
    word in memory preceding the data to be written. Otherwise, block lengths
    are taken from the instruction control digits. "fetchWord" is a function to
    read a word from the Processor's memory. This routine is used by MOW and MOR */
    var alarm = false;                  // error result
    var blocksLeft = true;              // true => more blocks to process
    var that = this;                    // local self-reference
    var words;

    function signalControl(controlWord) {
        /* Call-back function to send the EOT control word to the Processor
        and release it for the next operation */

        releaseProcessor(false, true, controlWord);
    }

    function blockReady(alarm, control, controlWord, writeBlock, completed) {
        /* Call-back function when the drive is ready to receive the next block
        of data, or when it has encountered an error such as EOT. "alarm"
        indicates that an error has occurred and the operation is to be aborted.
        "control" inidicates that an EOT block with a preface mismatch occurred,
        and "controlWord" is to be passed to the Processor for handling.
        Otherwise, if there are more blocks to write, fetches the next block
        from the Processor and calls the drive's "writeBlock" function, Finally
        calls "completed" to finish the operation */

        if (alarm) {
            setCallback(that.mnemonic, that, 0, releaseProcessor, true);
            completed(true);            // drive detected an error
        } else if (control) {
            setCallback(that.mnemonic, that, 0, signalControl, controlWord);
            completed(false);
        } else if (blocksLeft) {
            blocksLeft = that.decrementBlockCount();    // set to false on last block
            writeBlock(fetchWord, words);               // write the next block
        } else {
            setCallback(that.mnemonic, that, 0, releaseProcessor, false);
            completed(false);           // normal termination
        }
    }

    if (this.loadCommand(dReg, releaseProcessor, overwrite, arguments)) {
        this.controlBusy = true;
        if (this.blockWords < this.currentUnit.minBlockWords && this.blockWords > 1) {
            alarm = true;               // invalid block length
        } else {
            words = (record ? 0 : this.blockWords);
            alarm = this.currentUnit.overwriteBlock(blockReady, this.boundControlFinished);
        }

        if (alarm) {
            setCallback(this.mnemonic, this,  0, releaseProcessor, alarm);
            this.controlFinished(true);
        }
    }
};

/**************************************/
B220MagTapeControl.prototype.initialWrite = function initialWrite(dReg, releaseProcessor, record, fetchWord) {
    /* Initial-writes the number of blocks and of the size indicated in dReg.
    If "record" is true (MIR), block lengths (preface words) are taken from the
    word in memory preceding the data to be written. Otherwise, block lengths
    are taken from the instruction control digits. fetchWord" is a function to
    read a word from the Processor's memory. This routine is used by MIW and MIR */
    var alarm = false;                  // error result
    var blocksLeft = true;              // true => more blocks to process
    var that = this;                    // local self-reference
    var words;

    function blockReady(alarm, writeBlock, completed) {
        /* Call-back function when the drive is ready to receive the next block
        of data, or when it has encountered an error such as EOT. "alarm"
        indicates that an error has occurred and the operation is to be aborted.
        Otherwise, if there are more blocks to write, fetches the next block
        from the Processor and calls the drive's "writeBlock" function. Finally
        calls "completed" to finish the operation */

        if (alarm) {
            setCallback(that.mnemonic, that, 0, releaseProcessor, true);
            completed(true);            // drive detected an error
        } else if (blocksLeft) {
            blocksLeft = that.decrementBlockCount();    // set to false on last block
            writeBlock(fetchWord, words);               // write the next block
        } else {
            setCallback(that.mnemonic, that, 0, releaseProcessor, false);
            completed(false);           // normal termination
        }
    }

    if (this.loadCommand(dReg, releaseProcessor, initialWrite, arguments)) {
        this.controlBusy = true;
        if (this.blockWords < this.currentUnit.minBlockWords && this.blockWords > 1) {
            alarm = true;               // invalid block length
        } else {
            words = (record ? 0 : this.blockWords);
            alarm = this.currentUnit.initialWriteBlock(blockReady, this.boundControlFinished);
        }

        if (alarm) {
            setCallback(this.mnemonic, this,  0, releaseProcessor, alarm);
            this.controlFinished(true);
        }
    }
};

/**************************************/
B220MagTapeControl.prototype.positionForward = function positionForward(dReg, releaseProcessor) {
    /* Positions the tape forward the number of blocks indicated in dReg */
    var alarm = false;                  // error result
    var that = this;                    // local self-reference

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
        alarm = this.currentUnit.positionForward(blockFinished, this.boundControlFinished);
        setCallback(this.mnemonic, this,  0, releaseProcessor, alarm);
    }
};

/**************************************/
B220MagTapeControl.prototype.positionBackward = function positionBackward(dReg, releaseProcessor) {
    /* Positions the tape backward the number of blocks indicated in dReg */
    var alarm = false;                  // error result
    var that = this;                    // local self-reference

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
        alarm = this.currentUnit.positionBackward(blockFinished, this.boundControlFinished);
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
        alarm = this.currentUnit.positionAtEnd(this.boundControlFinished);
        setCallback(this.mnemonic, this,  0, releaseProcessor, alarm);
    }
};

/**************************************/
B220MagTapeControl.prototype.laneSelect = function laneSelect(dReg, releaseProcessor, fetchWord) {
    /* Selects the tape lane of the designated unit. Returns an alarm if the
    unit does not exist or is not ready */
    var alarm = false;                  // error result
    var laneNr;                         // lane to select (0, 1)

    if (this.loadCommand(dReg, releaseProcessor,laneSelect, arguments)) {
        this.controlBusy = true;
        laneNr = ((this.C - this.C%0x100)/0x100)%2;
        fetchWord(true);                // memory access for MTS/MFS not used by MLS
        alarm = this.currentUnit.laneSelect(laneNr, this.boundControlFinished);
        setCallback(this.mnemonic, this,  0, releaseProcessor, alarm);
    }
};

/**************************************/
B220MagTapeControl.prototype.rewind = function rewind(dReg, releaseProcessor, fetchWord) {
    /* Initiates rewind of the designated unit. Returns an alarm if the unit
    does not exist or is not ready */
    var alarm = false;                  // error result
    var laneNr;                         // lane to select (0, 1)
    var lockout;                        // lockout after rewind  (0, 1)

    if (this.loadCommand(dReg, releaseProcessor, rewind, arguments)) {
        this.controlBusy = true;
        laneNr = ((this.C - this.C%0x100)/0x100)%2;
        lockout = ((this.C - this.C%0x10)/0x10)%2;
        fetchWord(true);                // memory access for MTS/MFS not used by MRW/MDA
        alarm = this.currentUnit.rewind(laneNr, lockout);
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
    this.clearMisc();
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

    this.window.removeEventListener("beforeunload", B220MagTapeControl.prototype.beforeUnload, false);
    this.$$("ClearBtn").removeEventListener("click", this.boundSwitch_Click, false);
    this.regMisc.rightClearBar.removeEventListener("click", this.boundSwitch_Click, false);
    this.regC.rightClearBar.removeEventListener("click", this.boundSwitch_Click, false);
    this.regT.rightClearBar.removeEventListener("click", this.boundSwitch_Click, false);
    this.window.close();
};