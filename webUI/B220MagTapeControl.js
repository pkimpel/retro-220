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
    this.releaseProcessor = p.boundMagTapeComplete;

    // Do not call this.clear() here -- call this.clearUnit() from onLoad instead

    this.doc = null;
    this.window = window.open("../webUI/B220MagTapeControl.html", this.mnemonic,
            "location=no,scrollbars=no,resizable,width=712,height=144,top=" +
            (screen.availHeight - top) + ",left=" + left);
    this.window.addEventListener("load",
        B220Util.bindMethod(this, B220MagTapeControl.prototype.magTapeOnLoad));

    this.boundReleaseControl = B220MagTapeControl.prototype.releaseControl.bind(this);
    this.boundCancelIO = B220MagTapeControl.prototype.cancelIO.bind(this);
    this.boundTapeUnitFinished = B220MagTapeControl.prototype.tapeUnitFinished.bind(this);
    this.boundFetchWord = B220MagTapeControl.prototype.fetchWord.bind(this);
    this.boundStoreWord = B220MagTapeControl.prototype.storeWord.bind(this);
    this.boundSwitch_Click = B220MagTapeControl.prototype.switch_Click.bind(this);

    this.currentUnit = null;            // stashed tape unit object

    /* driveState is a status object passed to mag tape units that allows them
    to report their status back to the control unit */

    this.driveState = {
        state: 0,                       // state/error code, see below
        preface: 0,                     // preface/block length word
        keyword: 0,                     // block keyword (first data word)
        controlWord: 0,                 // block controlword (last data word)
        startTime: 0,                   // start time for the operation (ms)
        completionDelay: 0,             // extra delay before drive is released (ms)
        // State constants
        driveNoError: 0,                // operation successful
        driveNotReady: 1,               // drive not ready or rewind-lockout
        driveBusy: 2,                   // drive busy
        driveAtBOT: 3,                  // tape at physical BOT
        driveAtEOT: 4,                  // tape at physical EOT
        driveAtEOI: 5,                  // tape at end-of-information
        driveHasControlWord: 6,         // drive returned an EOT- or control-block control word
        drivePrefaceCheck: 10,          // invalid preface word
        drivePrefaceMismatch: 12,       // preface/instruction block-length mismatch
        driveReadCheck: 13,             // preface/tape block-length mismatch
        driveInvalidBlockLength: 14,    // invalid block length from instruction
        driveMemoryError: 15,           // memory address or parity error
        driveNotEditedTape: 16,         // attempt to initial-write over non-edited tape
        driveUndefined: 99};            // undefined error

    /* Set up the tape units from the system configuration. These can be any
    combination of Tape Storage Units (DataReaders) and DataFiles. The indexes
    into this array are physical unit numbers used internally -- unit designate
    is set on the tape unit itself */

    this.tapeUnit = [
        null,                           // 0=not used
        null,                           // tape unit A
        null,                           // tape unit B
        null,                           // tape unit C
        null,                           // tape unit D
        null,                           // tape unit E
        null,                           // tape unit F
        null,                           // tape unit G
        null,                           // tape unit H
        null,                           // tape unit I
        null];                          // tape unit J

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
    this.sField = 0;                    // starting digit position for field compare
    this.LField = 0;                    // length of field compare

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
B220MagTapeControl.prototype.fetchWord = function fetchWord(initialFetch) {
    /* Returns the next word from the Processor's memory, as addressed by the low
    four digits of its C register */
    var word = this.p.boundMagTapeSendWord(initialFetch);

    if (this.p.digitCheckAlarm.value) {
        this.p.setMagneticTapeCheck(1);
        return -1;
    } else {
        return word;
    }
};

/**************************************/
B220MagTapeControl.prototype.storeWord = function storeWord(initialStore, word) {
    /* Stores the word value in the next word of the Processor's memory, as
    addressed by the low four digits of its C register */

    this.p.boundMagTapeReceiveWord(initialStore, word);
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
B220MagTapeControl.prototype.loadCommand = function loadCommand(dReg, callee, args) {
    /* If the control unit or the tape unit addressed by the unit field in dReg
    are currently busy, queues the args parameter (an Arguments object) in
    this.pendingCallee and -Args, and returns false. If the control is idle but
    the tape unit is not ready or not present, or two units have the same designate,
    calls this.releaseProcessor and returns false. If the control and tape unit
    are ready for their next operation, loads the contents of the processor's
    D register passed to the operation routines into the T, C, and MISC registers.
    Sets this.unitNr, and this.unitIndex from the digits in T. Sets this.
    currentUnit to the current tape unit object. Then returns true to inidicate
    the I/O can proceed */
    var c;                              // scratch
    var proceed = false;                // return value: true => proceed with I/O
    var t = dReg%0x10000000000;         // temp to partition fields of Processor's D register
    var ux;                             // internal unit index

    //console.log(this.mnemonic + " loadCommand: " + dReg.toString(16));
    if (this.controlBusy) {
        this.queuePendingOperation(callee, args);
    } else {
        this.T = t;
        this.regT.update(this.T);
        this.unitNr = (t - t%0x1000000000)/0x1000000000;
        t = (t - t%0x10000)/0x10000;
        c = t%0x10;                     // low-order digit of op code
        t = (t - t%0x100)/0x100;        // control digits from instruction
        this.C = this.unitNr*0x100000 + t*0x10 + c;
        this.regC.update(this.C);
        this.clearMisc();
        this.unitIndex = ux = this.findDesignate(this.unitNr);
        if (ux < 0) {
            this.reportStatus(this.driveState.driveNotReady);   // drive not ready, not present
            this.releaseProcessor(false, 0);
        } else {
            this.currentUnit = this.tapeUnit[ux];
            if (this.currentUnit.busy || this.currentUnit.rewindLock) {
                this.queuePendingOperation(callee, args);
            } else {
                proceed = true;
                this.driveState.startTime = performance.now();
                this.driveState.completionDelay = 0;
                this.driveState.state = this.driveState.driveNoError;
            }
        }
    }

    return proceed;
};

/**************************************/
B220MagTapeControl.prototype.releaseControl = function releaseControl(param) {
    /* Releases the busy status of the control. If an error is present, sets the
    bits in the MISC register and the Processor's Magnetic Tape Check alarm, as
    appropriate. If another operation is pending, initiates that operation.
    Returns but does not use its parameter so that it can be used with
    Promise.then() */

    this.TFLamp.set(0);
    this.TBLamp.set(0);
    this.controlBusy = false;
    if (this.driveState.state != this.driveState.driveNoError) {
        this.currentUnit.releaseUnit(this.driveState);
        this.reportStatus(this.driveState.state);
    }

    if (this.pendingCallee !== null) {
        this.dequeuePendingOperation();
    }

    return param;
};

/**************************************/
B220MagTapeControl.prototype.cancelIO = function cancelIO(param) {
    /* Terminates the current I/O operation by releasing the Processor, tape
    unit, and tape control unit. Returns but does not use its parameter so it
    can be used with Promise.then() */

    this.releaseProcessor(false, 0);
    this.currentUnit.releaseUnit();
    this.releaseControl();
    return param;
};

/**************************************/
B220MagTapeControl.prototype.tapeUnitFinished = function tapeUnitFinished(param) {
    /* Call-back function passed to tape unit methods to signal when the unit has
    completed its asynchronous operation. Returns but does not use "param", so
    that it can be used with Promise.then() */

    if (!this.controlBusy) {            // if the control unit is currently idle...
        if (this.pendingCallee !== null) {
            this.dequeuePendingOperation();
        }
    }

    return param;
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
B220MagTapeControl.prototype.determineBlockLength = function determineBlockLength(record) {
    /* Determines the length of the next block to be read or written. If
    "record" is true, the length is fetched from the next word in the Processor's
    memory at the address in the Processor's C register. The length is converted
    to binary and checked for valid values. Returns a negative value on error.
    Note that the TCU always checks the kk digits from the instruction, even if
    this is a record-mode operation and those digits do not determine block length */
    var words = (this.C%0x1000 - this.C%0x10)/0x10; // kk digits from TCU C register

    if (words > 0) {
        words = (words >>> 4)*10 + words%0x10;
    } else {
        words = 100;                    // kk == 0 => 100
    }

    if (words < this.currentUnit.minBlockWords && words > 1) {
        words = -1;                     // invalid kk digits in instruction
        this.driveState.state = this.driveState.driveInvalidBlockLength;
    } else if (record) {
        words = this.fetchWord(true);
        if (words < 0) {                // memory fetch failed
            this.driveState.state = this.driveState.driveMemoryError;
        } else {                        // convert preface word to binary
            words = ((words - words%0x100000000)/0x100000000)%0x100;
            if (words > 0) {
                words = (words >>> 4)*10 + words%0x10;
            } else {
                words = 100;            // preface == 0 => 100
            }

            if (words < this.currentUnit.minBlockWords && words > 1) {
                words = -1;             // invalid preface read from memory
                this.driveState.state = this.driveState.driveInvalidBlockLength;
            }
        }
    }

    return words;
};

/**************************************/
B220MagTapeControl.prototype.determineFieldCompare = function determineFieldCompare(bReg) {
    /* Determines the field to be compared during search and scan operations.
    Decodes the sL value in bReg to this.sField and this.LField, checks that
    s<L, and if not, sets the Processor's Program Check alarm. Returns true if
    sL is invalid */
    var result = false;                 // return value

    this.sField = (bReg%0x10000 - bReg%0x1000)/0x1000;
    if (this.sField == 0) {
        this.sField = 10;
    }

    this.LField = (bReg%0x1000 - bReg%0x100)/0x100;
    if (this.LField == 0) {
        this.LField = 10;
    }

    if (this.sField < this.LField) {
        result = true;
        this.p.setProgramCheck(1);
    }

    return result;
};

/**************************************/
B220MagTapeControl.prototype.compareKeywordField = function compareKeywordField(keyword) {
    /* Compares "keyword" to the contents of the T register based on the partial-
    word parameters this.sField and this.LField. Returns -1 if the keyword is
    less than T, 0 if they are equal, and +1 if the keyword is greater than T */
    var L = this.LField;                // working copy of the field length
    var adder = 0;                      // digit adder
    var carry = 1;                      // decimal carry flag: 1 since we're subtracting
    var equal = true;                   // equality flag: assume true initially
    var kd = 0;                         // current keyword digit
    var kw = keyword;                   // working copy of the keyword value
    var s = this.sField;                // working copy of starting digit number
    var td = 0;                         // current T register digit
    var tw = this.T;                    // working copy of the T register value

    while (L > 0) {
        kd = kw%0x10;
        td = tw%0x10;
        if (s < 10) {
            ++s;                        // just shift until s=10
        } else {
            --L;
            adder = 9 - kd + td + carry;
            if (adder < 10) {
                carry = 0;
            } else {
                carry = 1;
                adder -= 10
            }

            if (adder) {
                equal = false;
            }
        }

        kw = (kw-kd)/0x10;              // shift both words right one digit
        tw = (tw-td)/0x10;
    } // while L

    if (equal) {
        return 0;                       // keyword equal T
    } else if (carry) {
        return -1;                      // keyword less than T
    } else {
        return 1;                       // keyword greater than T
    }
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
B220MagTapeControl.prototype.reportStatus = function reportStatus(state) {
    /* Sets bits in the MISC register to indicate various drive and control unit
    status and error conditions */

    switch (state) {
    case this.driveState.driveNoError:
        this.clearMisc();
        break;
    case this.driveState.driveNotReady:
        this.TX2Lamp.set(1);
        this.TX10Lamp.set(1);
        break;
    case this.driveState.drivePrefaceCheck:
        this.p.setMagneticTapeCheck(1);
        this.TPCLamp.set(1);
        break;
    case this.driveState.drivePrefaceMismatch:
        this.p.setMagneticTapeCheck(1);
        this.TCFLamp.set(1);
        this.C = (this.C & 0x00FFFF) | 0xFF0000;
        this.regC.update(this.C);
        break;
    case this.driveState.driveReadCheck:
        this.p.setMagneticTapeCheck(1);
        this.TYC1Lamp.set(1);
        this.TYC2Lamp.set(1);
        this.C = (this.C & 0xFFF00F) | 0x000F90;
        this.regC.update(this.C);
        break;
    case this.driveState.driveInvalidBlockLength:
        this.p.setMagneticTapeCheck(1);
        this.TX2Lamp.set(1);
        this.TX4Lamp.set(1);
        this.C = (this.C & 0x000F0F) | 0xB010F0;
        this.regC.update(this.C);
        break;
    case this.driveState.driveNotEditedTape:
        this.p.setMagneticTapeCheck(1);
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
    this.TYC1Lamp = this.regMisc.lamps[13];     // Yozzle toggle 1
    this.TYC1Lamp.setCaption("TYC", true);
    this.TYC2Lamp = this.regMisc.lamps[12];     // Yozzle toggle 2
    this.TYC2Lamp.setCaption("TYC", true);
    this.TCFLamp = this.regMisc.lamps[10];      // Preface compare failure: not in this register on a 220
    this.TCFLamp.setCaption("TCF", true);
    this.TFLamp = this.regMisc.lamps[9];        // Tape forward: not in this register on a 220
    this.TFLamp.setCaption("TF", true);
    this.TBLamp = this.regMisc.lamps[8];        // Tape bacward: not in this register on a 220
    this.TBLamp.setCaption("TB", true);
    this.TPCLamp = this.regMisc.lamps[7];       // Preface check
    this.TPCLamp.setCaption("TPC", true);
    this.regMisc.lamps[6].setCaption("TSX", true);
    this.regMisc.lamps[5].setCaption("1R6", true);
    this.TX1Lamp = this.regMisc.lamps[4];       // TX register
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
B220MagTapeControl.prototype.scan = function scan(dReg, bReg) {
    /* Scans a tape unit for a block with a word matching the word at the
    operand address in memory, which is stored in the TCU's T register. "bReg"
    is the contents of the B register for a partial-word match, or 0 for a
    full-word match. The index of the category word in the block to be compared
    to the scan key is determined from dReg:41. This routine is used by MTC and
    MFC */
    var laneNr = 0;                     // lane number from TCU C register
    var searchWord = 0;                 // target word to scan for
    var wordIndex = 0;                  // index of category word

    var scanForward = () => {
        /* Handles a block after it has been scanned in a forward direction.
        If the category word is not equal, continues scanning in a forward
        direction; otherwise, repositions to allow the matching block to be read
        next. If an EOT or control block is encountered, the control word from
        that block is ignored, and the tape is then repositioned, ready to read
        the EOT or control block. The drive forward scan stops in the erase gap
        of the block containing the category or control word, so a reposition
        backs up to allow reading the next block. A second reposition is needed
        is needed to back up into the prior block, allowing the block just
        scanned to be read next */
        var compare = 0;                // category word field comparison result

        if (this.driveState.state == this.driveState.driveHasControlWord) {
            // EOT or control block encountered: terminate the I/O
            this.driveState.state = this.driveState.driveNoError;
            this.TFLamp.set(0);
            this.TBLamp.set(1);
            this.currentUnit.reposition(this.driveState)        // reposition into the EOT block
            .then(this.currentUnit.boundReposition)             // reposition again into prior block
            .then(this.currentUnit.boundReleaseDelay)           //   allowing the EOT block to be read next
            .then(this.currentUnit.boundReleaseUnit)
            .then(this.boundReleaseControl)
            .catch(this.boundReleaseControl);
        } else {
            // Compare category word from tape with T register
            compare = this.compareKeywordField(this.driveState.keyword);
            if (compare != 0) {          // if category word unequal, keep scanning
                this.currentUnit.scanBlock(this.driveState, wordIndex)
                .then(scanForward)
                .catch(this.boundReleaseControl);
            } else {                    // Keyword was equal: stop and reposition
                this.TFLamp.set(0);
                this.TBLamp.set(1);
                this.currentUnit.reposition(this.driveState)    // reposition into the matching block
                .then(this.currentUnit.boundReposition)         // reposition again into prior block
                .then(this.currentUnit.boundReleaseDelay)       //   allowing the matching block to be read next
                .then(this.currentUnit.boundReleaseUnit)
                .then(this.boundReleaseControl)
                .catch(this.boundReleaseControl);
            }
        }
    };

    var scanFirstBlock = (driveState) => {
        /* Closure to call u.scanBlock with additional parameters from Promise.then() */

        this.currentUnit.scanBlock(this.driveState, wordIndex);
    };

    if (this.loadCommand(dReg, scan, arguments)) {
        this.controlBusy = true;
        this.driveState.completionDelay = 16;

        // Check for field compare validity
        if (this.determineFieldCompare(bReg)) {
            this.releaseProcessor(false, 0);
            this.releaseControl();
        } else {
            // Fetch the scan target word from memory
            searchWord = this.fetchWord(false);
            if (searchWord < 0) {
                this.driveState.state = this.driveState.driveMemoryError;
                this.releaseProcessor(false, 0);
                this.releaseControl();
            } else {
                // Start the scan after changing lane, as appropriate
                this.T = searchWord;
                this.regT.update(this.T);
                this.releaseProcessor(false, 0);
                this.TFLamp.set(1);
                laneNr = ((this.C - this.C%0x100)/0x100)%2;
                wordIndex = ((this.C - this.C%0x10)/0x10)%2;
                if (wordIndex == 0) {
                    wordIndex = 10;
                }

                this.currentUnit.setLane(laneNr, this.driveState)
                .then(this.currentUnit.boundStartUpForward)
                .then(scanFirstBlock)
                .then(scanForward)
                .catch(this.boundReleaseControl);
            }
        }
    }
};

/**************************************/
B220MagTapeControl.prototype.search = function search(dReg, bReg) {
    /* Searches a tape unit for a block with a keyword matching the word at the
    operand address in memory, which is stored in the TCU's T register. "bReg"
    is the contents of the B register for a partial-word match, or 0 for a
    full-word match. This routine is used by MTS and MFS */
    var laneNr = 0;                     // lane number from TCU C register
    var searchWord = 0;                 // target word to search for

    var searchForward = () => {
        /* Handles a block after it has been searched in a forward direction.
        If the keyword is low, continues searching in a forward direction;
        otherwise, reverses tape direction and initiates a backward search.
        If an EOT block is encountered, the control word from that block is
        ignored, and the tape is then repositioned, ready to read the EOT block.
        The drive forward search stops in the block after the keyword, so a
        reposition backs up to allow reading the block just searched */
        var compare = 0;                // keyword field comparison result

        if (this.driveState.state == this.driveState.driveHasControlWord) {
            // EOT block encountered: terminate the I/O
            this.driveState.state = this.driveState.driveNoError;
            this.TFLamp.set(0);
            this.TBLamp.set(1);
            this.currentUnit.reposition(this.driveState)
            .then(this.currentUnit.boundReleaseDelay)
            .then(this.currentUnit.boundReleaseUnit)
            .then(this.boundReleaseControl)
            .catch(this.boundReleaseControl);
        } else {
            // Compare keyword from tape with T register
            compare = this.compareKeywordField(this.driveState.keyword);
            if (compare < 0) {          // if keyword low, keep searching
                this.currentUnit.searchForwardBlock(this.driveState)
                .then(searchForward)
                .catch(this.boundReleaseControl);
            } else {                    // Keyword was high or equal: reverse direction
                this.TFLamp.set(0);
                this.TBLamp.set(1);
                this.currentUnit.reverseDirection(this.driveState)
                .then(this.currentUnit.boundSearchBackwardBlock)
                .then(searchBackward)
                .catch(this.boundReleaseControl);
            }
        }
    };

    var searchBackward = () => {
        /* Handles a block after it has been searched in a backward direction.
        If the keyword is high, continues searching in a backward direction.
        If the keyword is low, reverses tape direction again and searches one
        block in the forward direction. In this case, the result of the search
        is ignored, leaving the tape positioned to read the next block, which
        will be greater-than or equal-to the search target.
        If the keyword is equal, the tape is already positioned in the prior
        block, so we just quit, leaving the tape in position to read the block
        with the equal key */
        var compare = this.compareKeywordField(this.driveState.keyword);

        if (compare > 0) {              // keyword is high, continue searching...
            this.currentUnit.searchBackwardBlock(this.driveState)
            .then(searchBackward)
            .catch(this.boundReleaseControl);
        } else if (compare < 0) {       // keyword is low, reverse direction, search one block, and quit
            this.TBLamp.set(0);
            this.TFLamp.set(1);
            this.currentUnit.reverseDirection(this.driveState)
            .then(this.currentUnit.boundSearchForwardBlock)
            .then(this.currentUnit.boundReleaseDelay)
            .then(this.currentUnit.boundReleaseUnit)
            .then(this.boundReleaseControl)
            .catch(this.boundReleaseControl);
        } else {                        // keyword equal, just quit with tape positioned in prior block
            this.currentUnit.releaseDelay(this.driveState)
            .then(this.currentUnit.boundReleaseUnit)
            .then(this.boundReleaseControl)
            .catch(this.boundReleaseControl);
        }
    };

    if (this.loadCommand(dReg, search, arguments)) {
        this.controlBusy = true;
        this.driveState.completionDelay = 16;

        // Check for field compare validity
        if (this.determineFieldCompare(bReg)) {
            this.releaseProcessor(false, 0);
            this.releaseControl();
        } else {
            // Fetch the search target word from memory
            searchWord = this.fetchWord(false);
            if (searchWord < 0) {
                this.driveState.state = this.driveState.driveMemoryError;
                this.releaseProcessor(false, 0);
                this.releaseControl();
            } else {
                // Start the search after changing lane, as appropriate
                this.T = searchWord;
                this.regT.update(this.T);
                this.releaseProcessor(false, 0);
                this.TFLamp.set(1);
                laneNr = ((this.C - this.C%0x100)/0x100)%2;

                this.currentUnit.setLane(laneNr, this.driveState)
                .then(this.currentUnit.boundStartUpForward)
                .then(this.currentUnit.boundSearchForwardBlock)
                .then(searchForward)
                .catch(this.boundReleaseControl);
            }
        }
    }
};

/**************************************/
B220MagTapeControl.prototype.read = function read(dReg, record) {
    /* Reads the number of blocks indicated in dReg. If "record" is true (MRR),
    block lengths (preface words) are stored into the word in memory preceding
    the data read from tape. This routine is used by MRD and MRR */
    var controlEnabled = false;         // true => control blocks will be recognized

    var readBlock = () => {
        /* Reads blocks on the designated unit until the block count is
        exhausted or some error occurs. If an EOT block or control block
        is encountered, the drive returns the control word from that block and
        the I/O is terminated normally after passing the control word to the
        Processor for action. The tape is repositioned, ready to read the next
        block */

        if (this.driveState.state == this.driveState.driveHasControlWord) {
            this.driveState.state = this.driveState.driveNoError;
            this.releaseProcessor(true, this.driveState.controlWord);
            this.TFLamp.set(0);
            this.TBLamp.set(1);
            this.currentUnit.reposition(this.driveState)
            .then(this.currentUnit.boundReleaseDelay)
            .then(this.currentUnit.boundReleaseUnit)
            .then(this.boundReleaseControl)
            .catch(this.boundReleaseControl);
        } else if (this.decrementBlockCount()) {
            this.currentUnit.readNextBlock(this.driveState, record, controlEnabled, this.boundStoreWord)
            .then(readBlock)
            .catch(this.boundCancelIO);
        } else {                        // block count exhausted
            this.releaseProcessor(false, 0);
            this.TFLamp.set(0);
            this.TBLamp.set(1);
            this.currentUnit.reposition(this.driveState)
            .then(this.currentUnit.boundReleaseDelay)
            .then(this.currentUnit.boundReleaseUnit)
            .then(this.boundReleaseControl)
            .catch(this.boundReleaseControl);
        }
    };

    var readFirstBlock = (driveState) => {
        /* Closure to call u.readNextBlock with additional parameters from Promise.then() */

        this.currentUnit.readNextBlock(this.driveState, record, controlEnabled, this.boundStoreWord);
    };

    if (this.loadCommand(dReg, read, arguments)) {
        this.controlBusy = true;
        this.driveState.completionDelay = 18;
        controlEnabled = (this.C%0x20 < 0x10);  // low-order bit of instruction v-digit
        this.TFLamp.set(1);

        this.currentUnit.startUpForward(this.driveState)
        .then(readFirstBlock)
        .then(readBlock)
        .catch(this.boundCancelIO);
    }
};

/**************************************/
B220MagTapeControl.prototype.overwrite = function overwrite(dReg, record) {
    /* Overwrites the number of blocks and of the size indicated in dReg. If
    "record" is true (MOR), block lengths (preface words) are taken from the
    word in memory preceding the data to be written. Otherwise, block lengths
    are taken from the instruction control digits. This routine is used by
    MOW and MOR */
    var blocksLeft = true;              // true => more blocks to process

    var writeBlock = () => {
        /* Overwrites blocks on the designated unit until the block count is
        exhausted or some error occurs. If an EOT block with a preface mismatch
        is encountered, the drive returns the control word from that block and
        the I/O is terminated normally after passing the control word to the
        Processor for action. The tape is repositioned, ready to read the next
        block */
        var words = 0;

        if (this.driveState.state == this.driveState.driveHasControlWord) {
            this.driveState.state = this.driveState.driveNoError;
            this.releaseProcessor(true, this.driveState.controlWord);
            this.TFLamp.set(0);
            this.TBLamp.set(1);
            this.currentUnit.reposition(this.driveState)
            .then(this.currentUnit.boundReleaseDelay)
            .then(this.currentUnit.boundReleaseUnit)
            .then(this.boundReleaseControl)
            .catch(this.boundReleaseControl);
        } else if (blocksLeft) {
            words = this.determineBlockLength(record);
            if (words < 0) {
                this.cancelIO();
            } else {
                blocksLeft = this.decrementBlockCount();
                this.currentUnit.overwriteBlock(this.driveState, record, words, this.boundFetchWord)
                .then(writeBlock)
                .catch(this.boundCancelIO);
            }
        } else {                        // block count exhausted
            this.releaseProcessor(false, 0);
            this.TFLamp.set(0);
            this.TBLamp.set(1);
            this.currentUnit.reposition(this.driveState)
            .then(this.currentUnit.boundReleaseDelay)
            .then(this.currentUnit.boundReleaseUnit)
            .then(this.boundReleaseControl)
            .catch(this.boundReleaseControl);
        }
    };

    if (this.loadCommand(dReg, overwrite, arguments)) {
        this.controlBusy = true;
        this.driveState.completionDelay = 18;
        this.TFLamp.set(1);

        this.currentUnit.startUpForward(this.driveState)
        .then(writeBlock)
        .catch(this.boundCancelIO);
    }
};

/**************************************/
B220MagTapeControl.prototype.initialWrite = function initialWrite(dReg, record) {
    /* Initial-writes the number of blocks and of the size indicated in dReg.
    If "record" is true (MIR), block lengths (preface words) are taken from the
    word in memory preceding the data to be written. Otherwise, block lengths
    are taken from the instruction control digits. This routine is used by
    MIW and MIR */
    var blocksLeft = true;              // true => more blocks to process

    var writeBlock = () => {
        /* Initial-writes blocks on the designated unit until the block count is
        exhausted or some error occurs */
        var words = 0;

        if (blocksLeft) {
            words = this.determineBlockLength(record);
            if (words < 0) {
                this.cancelIO();
            } else {
                blocksLeft = this.decrementBlockCount();
                this.currentUnit.initialWriteBlock(this.driveState, record, words, this.boundFetchWord)
                .then(writeBlock)
                .catch(this.boundCancelIO);
            }
        } else {                        // block count exhausted
            this.releaseProcessor(false, 0);
            this.TFLamp.set(0);         // direction actually changes after WriteFinalize
            this.TBLamp.set(1);         // but that's messy to do here...
            this.currentUnit.initialWriteFinalize(this.driveState)
            .then(this.currentUnit.boundReposition)
            .then(this.currentUnit.boundReleaseDelay)
            .then(this.currentUnit.boundReleaseUnit)
            .then(this.boundReleaseControl)
            .catch(this.boundReleaseControl);
        }
    };

    if (this.loadCommand(dReg, initialWrite, arguments)) {
        this.controlBusy = true;
        this.driveState.completionDelay = 20;
        this.TFLamp.set(1);

        this.currentUnit.startUpForward(this.driveState)
        .then(writeBlock)
        .catch(this.boundCancelIO);
    }
};

/**************************************/
B220MagTapeControl.prototype.positionForward = function positionForward(dReg) {
    /* Positions the tape forward the number of blocks indicated in dReg */

    var spaceBlock = () => {
        /* Spaces forward over blocks on the designated unit until the block
        count is exhausted or some error (like end-of-tape) occurs */

        if (this.decrementBlockCount()) {
            this.currentUnit.spaceForwardBlock(this.driveState)
            .then(spaceBlock)
            .catch(this.boundReleaseControl);
        } else {                        // block count exhausted
            this.TFLamp.set(0);
            this.TBLamp.set(1);
            this.currentUnit.reposition(this.driveState)
            .then(this.currentUnit.boundReleaseDelay)
            .then(this.currentUnit.boundReleaseUnit)
            .then(this.boundReleaseControl)
            .catch(this.boundReleaseControl);
        }
    };

    if (this.loadCommand(dReg, positionForward, arguments)) {
        this.controlBusy = true;
        this.driveState.completionDelay = 16;
        this.releaseProcessor(false, 0);
        this.TFLamp.set(1);

        this.currentUnit.startUpForward(this.driveState)
        .then(this.currentUnit.boundSpaceForwardBlock)
        .then(spaceBlock)
        .catch(this.boundReleaseControl);
    }
};

/**************************************/
B220MagTapeControl.prototype.positionBackward = function positionBackward(dReg) {
    /* Positions the tape backward the number of blocks indicated in dReg */

    var spaceBlock = () => {
        /* Spaces backward over blocks on the designated unit until the block
        count is exhausted or some error (like beginning-of-tape) occurs */

        if (this.decrementBlockCount()) {
            this.currentUnit.spaceBackwardBlock(this.driveState)
            .then(spaceBlock)
            .catch(this.boundReleaseControl);
        } else {                        // block count exhausted
            this.currentUnit.boundReleaseDelay(this.driveState)
            .then(this.currentUnit.boundReleaseUnit)
            .then(this.boundReleaseControl)
            .catch(this.boundReleaseControl);
        }
    };

    if (this.loadCommand(dReg, positionBackward, arguments)) {
        this.controlBusy = true;
        this.driveState.completionDelay = 6;
        this.releaseProcessor(false, 0);
        this.TBLamp.set(1);

        this.currentUnit.startUpBackward(this.driveState)
        .then(this.currentUnit.boundSpaceBackwardBlock)
        .then(spaceBlock)
        .catch(this.boundReleaseControl);
    }
};

/**************************************/
B220MagTapeControl.prototype.positionAtEnd = function positionAtEnd(dReg) {
    /* Positions the tape to the end of recorded information (i.e., when a gap
    longer than inter-block gap is detected. Leaves the tape at the end of the
    prior recorded block */

    var spaceBlock = () => {
        /* Spaces over blocks on the designated unit until end-of-information is
        detected or some error (like end-of-tape) occurs */

        if (this.driveState.state != this.driveState.driveAtEOI) {
            this.currentUnit.spaceEOIBlock(this.driveState)
            .then(spaceBlock)
            .catch(this.boundReleaseControl);
        } else {                        // found end-of-information
            this.driveState.state = this.driveState.driveNoError;
            this.TFLamp.set(0);
            this.TBLamp.set(1);
            this.currentUnit.reposition(this.driveState)
            .then(this.currentUnit.boundReleaseDelay)
            .then(this.currentUnit.boundReleaseUnit)
            .then(this.boundReleaseControl)
            .catch(this.boundReleaseControl);
        }
    };

    if (this.loadCommand(dReg, positionAtEnd, arguments)) {
        this.controlBusy = true;
        this.driveState.completionDelay = 23;
        this.releaseProcessor(false, 0);
        this.TFLamp.set(1);

        this.currentUnit.startUpForward(this.driveState)
        .then(this.currentUnit.boundSpaceEOIBlock)
        .then(spaceBlock)
        .catch(this.boundReleaseControl);
    }
};

/**************************************/
B220MagTapeControl.prototype.laneSelect = function laneSelect(dReg) {
    /* Selects the tape lane of the designated unit. Returns an alarm if the
    unit does not exist or is not ready */
    var laneNr;                         // lane to select (0, 1)

    if (this.loadCommand(dReg, laneSelect, arguments)) {
        this.controlBusy = true;
        laneNr = ((this.C - this.C%0x100)/0x100)%2;
        this.driveState.completionDelay = 3;
        this.fetchWord(true);           // memory access for MTS/MFS not used by MLS
        this.releaseProcessor(false, 0);

        this.currentUnit.laneSelect(this.driveState, laneNr)
        .then(this.currentUnit.boundReleaseDelay)
        .then(this.currentUnit.boundReleaseUnit)
        .then(this.boundReleaseControl)
        .catch(this.boundReleaseControl);
    }
};

/**************************************/
B220MagTapeControl.prototype.rewind = function rewind(dReg) {
    /* Initiates rewind of the designated unit. Returns an alarm if the unit
    does not exist or is not ready */
    var laneNr;                         // lane to select (0, 1)
    var lockout;                        // lockout after rewind  (0, 1)

    if (this.loadCommand(dReg, rewind, arguments)) {
        this.controlBusy = true;
        laneNr = ((this.C - this.C%0x100)/0x100)%2;
        lockout = ((this.C - this.C%0x10)/0x10)%2;
        this.fetchWord(true);           // memory access for MTS/MFS not used by MRW/MDA
        this.releaseProcessor(false, 0);
        this.TBLamp.set(1);
        setCallback(this.mnemonic, this, 50, this.releaseControl, this.driveState);

        this.currentUnit.rewind(this.driveState, laneNr, lockout)
        .then(this.currentUnit.boundReleaseUnit)
        .then(this.boundTapeUnitFinished);
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
B220MagTapeControl.prototype.testUnitAtEOT = function testUnitAtEOT(dReg) {
    /* Interrogates status of the designated unit. Returns true if ready and at
    end-of-tape */
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