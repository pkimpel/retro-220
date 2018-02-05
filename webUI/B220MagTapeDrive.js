/***********************************************************************
* retro-220/webUI B220MagTapeDrive.js
************************************************************************
* Copyright (c) 2017, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* Burroughs 220 Magnetic Tape Drive Peripheral Unit module.
*
* Defines a magnetic tape drive peripheral unit type, emulating the
* 220 Tape Storage Unit at 208.333 bits/inch and 120 inches/sec.
*
* Internally, tape images are maintained as a two-dimensional array of 64-bit
* floating-point words, similar to Javascript Number objects. The first dimension
* represents lanes on the tape; the second represents words in tape blocks.
*
* Blocks are formatted internally in a manner similar to their physical layout
* on tape, as follows. This scheme was chosen to allow reasonable behavior after
* a lane change with an MLS command:
*
*   * The tape begins with 2083 words of flaw markers (-4 words, see below).
*     This represents the magnetic beginning-of-tape area written to
*     newly-edited tape.
*
*   * Tape words are stored as non-negative floating-point values having 11 BCD
*     digits (44 bits) each. The high-order digit is the 220 sign.
*
*   * Negative word values are used to designate special control words in the
*     tape image:
*        -1 Blank (erased) tape/inter-block gap words
*        -2 End-of-block and erase-gap words
*        -3 Magnetic end-of-tape words
*        -4 Flaw markers and magnetic beginning-of-tape words
*
*   * A block begins with three inter-block gap (-1) words, followed by the
*     preface word. The preface word contains the length of the block in BINARY,
*     not BCD. Maximum valid value of a preface word is 100 (not zero). A preface
*     value of one indicates an end-of-tape block, although the block will
*     contain 10 words, the first of which is the EOT control word. Values 0 and
*     2-9 are invalid block sizes.
*
*   * Following the preface word are the data words for the block. In the case
*     of an end-of-tape block, the first word will be the EOT control word; the
*     remaining nine words will be zeroes.
*
*   * Following the data words for the block will be two end-of-block/erase-gap
*     (-2) words. The inter-block gap words for the next block (or magnetic
*     end-of-tape or flaw marker words) begin immediately after these two words.
*
*   * The tape ends with 2916 words of magnetic end-of-tape (-3) words. This
*     represents the magnetic end-of-tape area written to newly-edited tape.
*
* External tape images are ordinary text files in comma-separated variable (CSV)
* format. Each line in the file represents one block for one lane. Lines may be
* delimited by ASCII line-feed (hex 0A), carriage-return (hex 0D) or a carriage-
* return/line-feed pair.
*
* The first field on the line contains one or two integers, formatted as "L" or
* "R*L". L represents the lane number. Only its low-order bit (0/1) is used.
* R is a repeat factor used to compress the size of tape image files. It
* indicates the number of copies of this block that exist consecutively at this
* point in the tape image. If R and its delimiting "*" are not present, R is
* assumed to be one. If R is not present, the "*" must also be not present.
*
* The second field on a line is the preface word indicating the length of the
* data. A block length of 100 may be represented as either 0 or 100. Values
* greater than 100 or less than zero will be treated as 100.
*
* The remaining fields on a line represent the data words of the block. Since
* words are stored internally in 4-bit BCD, these fields are interpreted as
* hexadecimal values, although normally they should be composed only using the
* decimal digits. Leading zero digits may be omitted. The digits of a word may
* be preceded by a hyphen ("-"), which will cause a 1 to be OR-ed into the sign
* digit of the word. Spaces may precede or follow the digits of a field, but may
* not appear within the digits or between any leading "-" and the first digit.
*
* Note that with this representation, it is possible that the word count in
* the preface may not match the actual number of words on the rest of the line.
* While this might be useful at some point to allow construction of invalid
* tape blocks that generate Tape Preface Failure (TPF) halts, at present the
* block is stored in the internal tape image with exactly the number of words
* specified by the preface. The words specified on the line will be truncated
* or padded with zero words as necessary in the internal image to achieve this
* block length.
*
* Also note that the arrangement of blocks with respect to their lane is
* arbitrary. Blocks for a lane can be arranged on the external image separately
* or intermingled with the blocks for the other lane. The only requirement is
* that blocks for a lane be in sequence. When exporting a tape image that has
* been modified, the drive will always dump all of lane 0 and then all of
* lane 1. To save space in the external image, trailing words of zeroes will
* be trimmed from each block, and consecutive blocks containing the same data
* will be compressed using the R*L notation discussed above. The lane number
* and preface fields will always be written, however.
*
************************************************************************
* 2017-07-09  P.Kimpel
*   Original version, from retro-205 D205MagTapeDrive.js.
***********************************************************************/
"use strict";

/**************************************/
function B220MagTapeDrive(mnemonic, unitIndex, tcu, config) {
    /* Constructor for the MagTapeDrive object */
    var y = ((mnemonic.charCodeAt(2) - "A".charCodeAt(0))*32) + 304;

    this.config = config;               // System configuration object
    this.mnemonic = mnemonic;           // Unit mnemonic
    this.tcu = tcu;                     // Tape Control Unit object
    this.unitIndex = unitIndex;         // Internal unit number
    this.unitDesignate = -1;            // External unit number

    this.timer = 0;                     // setCallback() token

    this.remote = false;                // Remote/Ready status
    this.notWrite = false;              // Not-Write status
    this.rewindLock = false;            // Rewind-Lock status
    this.powerOn = false;               // Transport power on/standby status

    this.clear();

    this.loadWindow = null;             // handle for the tape loader window
    this.reelBar = null;                // handle for tape-full meter
    this.reelIcon = null;               // handle for the reel spinner

    this.boundInitialWriteBlock = B220MagTapeDrive.prototype.initialWriteBlock.bind(this);
    this.boundOverwriteBlock = B220MagTapeDrive.prototype.overwriteBlock.bind(this);
    this.boundReadNextBlock = B220MagTapeDrive.prototype.readNextBlock.bind(this);
    this.boundReleaseDelay = B220MagTapeDrive.prototype.releaseDelay.bind(this);
    this.boundReleaseUnit = B220MagTapeDrive.prototype.releaseUnit.bind(this);
    this.boundReposition = B220MagTapeDrive.prototype.reposition.bind(this);
    this.boundReverseDirection = B220MagTapeDrive.prototype.reverseDirection.bind(this);
    this.boundSearchBackwardBlock = B220MagTapeDrive.prototype.searchBackwardBlock.bind(this);
    this.boundSearchForwardBlock = B220MagTapeDrive.prototype.searchForwardBlock.bind(this);
    this.boundSetBOT = B220MagTapeDrive.prototype.setBOT.bind(this);
    this.boundSetEOT = B220MagTapeDrive.prototype.setEOT.bind(this);
    this.boundSpaceBackwardBlock = B220MagTapeDrive.prototype.spaceBackwardBlock.bind(this);
    this.boundSpaceEOIBlock = B220MagTapeDrive.prototype.spaceEOIBlock.bind(this);
    this.boundSpaceForwardBlock = B220MagTapeDrive.prototype.spaceForwardBlock.bind(this);
    this.boundStartUpBackward = B220MagTapeDrive.prototype.startUpBackward.bind(this);
    this.boundStartUpForward = B220MagTapeDrive.prototype.startUpForward.bind(this);

    this.doc = null;
    this.window = window.open("../webUI/B220MagTapeDrive.html", mnemonic,
            "location=no,scrollbars=no,resizable,width=384,height=184,left=0,top=" + y);
    this.window.addEventListener("load",
            B220MagTapeDrive.prototype.tapeDriveOnload.bind(this), false);
}

// this.tapeState enumerations
B220MagTapeDrive.prototype.tapeUnloaded = 0;
B220MagTapeDrive.prototype.tapeLocal = 1;
B220MagTapeDrive.prototype.tapeRewinding = 2;
B220MagTapeDrive.prototype.tapeRemote = 3;

// Internal tape image control words
B220MagTapeDrive.prototype.markerGap = -1;
B220MagTapeDrive.prototype.markerEOB = -2;
B220MagTapeDrive.prototype.markerMagEOT = -3;
B220MagTapeDrive.prototype.markerFlaw = -4;

B220MagTapeDrive.prototype.density = 208.333;
                                        // bits/inch
B220MagTapeDrive.prototype.tapeSpeed = 120/1000;
                                        // tape motion speed [inches/ms]
B220MagTapeDrive.prototype.inchesPerWord = 12/B220MagTapeDrive.prototype.density;
B220MagTapeDrive.prototype.millisPerWord = B220MagTapeDrive.prototype.inchesPerWord/B220MagTapeDrive.prototype.tapeSpeed;
B220MagTapeDrive.prototype.maxTapeInches = 3500*12;
                                        // length of a standard reel of tape [inches]
B220MagTapeDrive.prototype.maxTapeWords = Math.floor(B220MagTapeDrive.prototype.maxTapeInches*B220MagTapeDrive.prototype.density/12);
                                        // max words on a tape (12 digits/word)
B220MagTapeDrive.prototype.minBlockWords = 10;
                                        // min words in a physical block
B220MagTapeDrive.prototype.maxBlockWords = 100;
                                        // max words in a physical block
B220MagTapeDrive.prototype.magBOTWords = Math.floor(10*12*B220MagTapeDrive.prototype.density/12);
                                        // number of words in the magnetic beginning-of-tape area
B220MagTapeDrive.prototype.magEOTWords = Math.floor(14*12*B220MagTapeDrive.prototype.density/12);
                                        // number of words in the magnetic end-of-tape area
B220MagTapeDrive.prototype.startOfBlockWords = 4;
                                        // inter-block tape gap + preface [words]
B220MagTapeDrive.prototype.endOfBlockWords = 2;
                                        // end-of-block + erase gap [words]
B220MagTapeDrive.prototype.repositionWords = 5;
                                        // number of words to reposition back into the block after a turnaround
B220MagTapeDrive.prototype.startTime = 3;
                                        // tape start time [ms]
B220MagTapeDrive.prototype.startWords = 6;
                                        // number of words traversed during tape start time
B220MagTapeDrive.prototype.stopTime = 3;
                                        // tape stop time [ms]
B220MagTapeDrive.prototype.turnaroundTime = 5;
                                        // tape turnaround time after a direction change [ms]
B220MagTapeDrive.prototype.rewindSpeed = 0.120;
                                        // rewind speed [inches/ms]
B220MagTapeDrive.prototype.reelCircumference = 10*Math.PI;
                                        // max circumference of tape [inches]
B220MagTapeDrive.prototype.spinUpdateInterval = 15;
                                        // milliseconds between reel icon angle updates
B220MagTapeDrive.prototype.maxSpinAngle = 33;
                                        // max angle to rotate reel image [degrees]


/**************************************/
B220MagTapeDrive.prototype.$$ = function $$(e) {
    return this.doc.getElementById(e);
};

/**************************************/
B220MagTapeDrive.prototype.clear = function clear() {
    /* Initializes (and if necessary, creates) the reader unit state */

    this.ready = false;                 // ready status
    this.busy = false;                  // busy status

    this.image = null;                  // tape drive "reel of tape"
    this.imgIndex = 0;                  // current word index in tape image
    this.imgLength = 0;                 // tape image max length [words] to physical EOT
    this.imgTopWordNr = 0;              // highest-written word index within image data
    this.imgWritten = false;            // tape image has been modified (implies writable)

    this.atBOT = true;                  // true if tape at physical beginning-of-tape
    this.atEOT = false;                 // true if tape at physical end-of-tape
    this.laneNr = 0;                    // currently selected lane number
    this.reelAngle = 0;                 // current rotation angle of reel image [degrees]
    this.tapeInches = 0;                // current distance up-tape [inches]
    this.tapeState = this.tapeUnloaded; // tape drive state
};

/**************************************/
B220MagTapeDrive.prototype.releaseUnit = function releaseUnit(param) {
    /* Releases the busy status of the unit. Returns but does not use its
    parameter so it can be used with Promise.then() */

    this.busy = false;
    this.designatedLamp.set(0);
    return param;
};

/**************************************/
B220MagTapeDrive.prototype.releaseDelay = function releaseDelay(driveState) {
    /* Delays the specified number of milliseconds in driveState.completionDelay.
    Returns a Promise for completion of the delay */

    return new Promise((resolve, reject) => {
        setCallback(this.mnemonic, this, driveState.completionDelay, resolve, driveState);
    });
};

/**************************************/
B220MagTapeDrive.prototype.setUnitDesignate = function setUnitDesignate(index) {
    /* Sets this.unitDesignate from the UNIT DESIGNATE list selectedIndex value */

    if (index <= 0) {
        this.unitDesignate = -1;
        this.remote = false;
        this.setTapeReady(false);
    } else {
        if (index < 10) {
            this.unitDesignate = index;         // units 1-9
        } else {
            this.unitDesignate = 0;             // unit 10
        }

        this.remote = true;
        this.setTapeReady(true);
    }
};

/**************************************/
B220MagTapeDrive.prototype.setAtBOT = function setAtBOT(atBOT) {
    /* Controls the at-Beginning-of-Tape state of the tape drive */

    if (atBOT ^ this.atBOT) {
        this.atBOT = atBOT;
        if (!atBOT) {
            B220Util.removeClass(this.$$("MTAtBOTLight"), "annunciatorLit");
        } else {
            this.imgIndex = 0;
            this.tapeInches = 0;
            this.reelAngle = 0;
            B220Util.addClass(this.$$("MTAtBOTLight"), "annunciatorLit");
            this.reelBar.value = this.maxTapeInches;
            this.reelIcon.style.transform = "none";
        }
    }
};

/**************************************/
B220MagTapeDrive.prototype.setBOT = function setBOT(driveState) {
    /* Sets BOT status on the drive and releases the drive after encountering
    physical BOT. Return value is designed for use with Promise.then() */

    this.setAtBOT(true);
    this.releaseUnit(driveState);       // release the unit, but leave the control hung:
    return driveState;                  // do not reject the Promise
};

/**************************************/
B220MagTapeDrive.prototype.setAtEOT = function setAtEOT(atEOT) {
    /* Controls the at-End-of-Tape state of the tape drive */

    if (atEOT ^ this.atEOT) {
        this.atEOT = atEOT;
        if (!atEOT) {
            B220Util.removeClass(this.$$("MTAtEOTLight"), "annunciatorLit");
        } else {
            B220Util.addClass(this.$$("MTAtEOTLight"), "annunciatorLit");
            this.reelBar.value = 0;
        }
    }
};

/**************************************/
B220MagTapeDrive.prototype.setEOT = function setEOT(driveState) {
    /* Sets EOT status on the drive and releases the drive after encountering
    physical EOT. Return value is designed for use with Promise.then() */

    this.setAtEOT(true);
    this.releaseUnit(driveState);       // release the unit, but leave the control hung:
    return driveState;                  // do not reject the Promise
};

/**************************************/
B220MagTapeDrive.prototype.setLane = function(laneNr, param) {
    /* Sets the lane of the tape drive and updates its annunciator on the drive
    control panel. If the lane is changing, introduces a 70ms delay. Returns a
    Promise that resolves once the lane is changed and any delay is completed.
    "param" is not used by this routine, but is passed as a resolve result for
    use with Promise.then() */
    var lane = laneNr%2;                // make sure it's 0 or 1

    this.$$("MTLaneNrLight").textContent = "LANE " + lane;
    return new Promise((resolve, reject) => {
        if (this.laneNr == lane) {
            resolve(param);
        } else {
            this.laneNr = lane;
            setCallback(this.mnemonic, this, 70, resolve, param);
        }
    });
};

/**************************************/
B220MagTapeDrive.prototype.setTapeReady = function setTapeReady(makeReady) {
    /* Controls the ready-state of the tape drive */
    var enabled = (this.tapeState != this.tapeUnloaded) && !this.rewindLock &&
                  (this.tapeState != this.tapeRewinding && this.powerOn);

    this.ready = this.remote & makeReady && enabled;
    this.notReadyLamp.set(this.ready ? 0 : 1);
    if (this.ready) {
        this.tapeState = this.tapeRemote;
    } else {
        this.busy = false;              // forced reset
        this.designatedLamp.set(0);
        if (this.tapeState == this.tapeRemote) {
            this.tapeState = this.tapeLocal;
        }
    }
};

/**************************************/
B220MagTapeDrive.prototype.setTapeUnloaded = function setTapeUnloaded() {
    /* Controls the loaded/unloaded-state of the tape drive */

    if (this.tapeState == this.tapeLocal && this.atBOT) {
        this.tapeState = this.tapeUnloaded;
        this.image = null;                  // release the tape image to GC
        this.imgLength = 0;
        this.imgTopWordNr = 0;
        this.busy = false;
        this.rewindLock = false;
        this.rwlLamp.set(0);
        this.setTapeReady(false);
        this.setAtBOT(false);
        this.setAtEOT(false);
        this.reelBar.value = 0;
        this.reelIcon.style.visibility = "hidden";
        this.$$("MTFileName").value = "";
        this.$$("MTLaneNrLight").style.visibility = "hidden";
        B220Util.addClass(this.$$("MTUnloadedLight"), "annunciatorLit");
        if (this.timer) {
            clearCallback(this.timer);
            this.timer = 0;
        }
    }
};

/**************************************/
B220MagTapeDrive.prototype.tapeRewind = function tapeRewind(laneNr, lockout) {
    /* Rewinds the tape. Makes the drive not-ready and delays for an appropriate
    amount of time depending on how far up-tape we are. Readies the unit again
    when the rewind is complete unless lockout is truthy. Returns a Promise that
    resolves when the rewind completes */

    return new Promise((resolve, reject) => {
        var lastStamp;

        function rewindFinish() {
            this.timer = 0;
            this.tapeState = this.tapeLocal;
            B220Util.removeClass(this.$$("MTRewindingLight"), "annunciatorLit");
            this.rewindLock = (lockout ? true : false);
            this.rwlLamp.set(this.rewindLock ? 1 : 0);
            this.setTapeReady(!this.rewindLock);
            resolve(this.setLane(laneNr, null));
        }

        function rewindDelay() {
            var inches;
            var stamp = performance.now();
            var interval = stamp - lastStamp;

            if (interval <= 0) {
                interval = this.spinUpdateInterval/2;
            }
            if (this.tapeInches <= 0) {
                this.setAtBOT(true);
                this.timer = setCallback(this.mnemonic, this, 1000, rewindFinish);
            } else {
                inches = interval*this.rewindSpeed;
                lastStamp = stamp;
                this.timer = setCallback(this.mnemonic, this, this.spinUpdateInterval, rewindDelay);
                this.spinReel(-inches);
            }
        }

        function rewindStart() {
            this.designatedLamp.set(0);
            lastStamp = performance.now();
            this.timer = setCallback(this.mnemonic, this, this.spinUpdateInterval, rewindDelay);
        }

        if (this.timer) {
            clearCallback(this.timer);
            this.timer = 0;
        }

        if (this.tapeState != this.tapeUnloaded && this.tapeState != this.tapeRewinding) {
            this.busy = true;
            this.tapeState = this.tapeRewinding;
            this.setAtEOT(false);
            B220Util.addClass(this.$$("MTRewindingLight"), "annunciatorLit");
            this.timer = setCallback(this.mnemonic, this, 1000, rewindStart);
        }
    });
};

/**************************************/
B220MagTapeDrive.prototype.spinReel = function spinReel(inches) {
    /* Rotates the reel image icon an appropriate amount based on the "inches"
    of tape to be moved. The rotation is limited to this.maxSpinAngle degrees
    in either direction so that movement remains apparent to the viewer */
    var circumference = this.reelCircumference*(1 - this.tapeInches/this.maxTapeInches/2);
    var degrees = inches/circumference*360;

    if (degrees > this.maxSpinAngle) {
        degrees = this.maxSpinAngle;
    } else if (degrees < -this.maxSpinAngle) {
        degrees = -this.maxSpinAngle;
    }

    this.reelAngle = (this.reelAngle + degrees)%360;
    this.reelIcon.style.transform = "rotate(" + this.reelAngle.toFixed(0) + "deg)";

    this.tapeInches += inches;
    if (this.tapeInches < this.maxTapeInches) {
        this.reelBar.value = this.maxTapeInches - this.tapeInches;
    } else {
        this.reelBar.value = 0;
    }
};

/**************************************/
B220MagTapeDrive.prototype.moveTape = function moveTape(inches, delay, successor, param) {
    /* Delays the I/O during tape motion, during which it animates the reel image
    icon. At the completion of the "delay" time in milliseconds, "successor" is
    called with "param" as a parameter */
    var delayLeft = Math.abs(delay);    // milliseconds left to delay
    var direction = (inches < 0 ? -1 : 1);
    var inchesLeft = inches;            // inches left to move tape
    var initiallyReady = this.ready;    // remember initial ready state to detect change
    var lastStamp = performance.now();  // last timestamp for spinDelay

    function spinFinish() {
        this.timer = 0;
        if (inchesLeft != 0) {
            this.spinReel(inchesLeft);
        }
        successor.call(this, param);
    }

    function spinDelay() {
        var motion;
        var stamp = performance.now();
        var interval = stamp - lastStamp;

        if (interval <= 0) {
            interval = this.spinUpdateInterval/2;
            if (interval > delayLeft) {
                interval = delayLeft;
            }
        }

        if (initiallyReady && !this.ready) { // drive went not ready
            inchesLeft = 0;
            this.timer = setCallback(this.mnemonic, this, this.spinUpdateInterval, spinFinish);
        } else {
            delayLeft -= interval;
            if (delayLeft > this.spinUpdateInterval) {
                lastStamp = stamp;
                this.timer = setCallback(this.mnemonic, this, this.spinUpdateInterval, spinDelay);
            } else {
                this.timer = setCallback(this.mnemonic, this, delayLeft, spinFinish);
            }

            motion = inchesLeft*interval/delayLeft;
            if (inchesLeft*direction <= 0) { // inchesLeft crossed zero
                motion = inchesLeft = 0;
            } else if (motion*direction <= inchesLeft*direction) {
                inchesLeft -= motion;
            } else {
                motion = inchesLeft;
                inchesLeft = 0;
            }

            this.spinReel(motion);
        }
    }

    spinDelay.call(this);
};

/**************************************/
B220MagTapeDrive.prototype.moveTapeTo = function moveTapeTo(index, result) {
    /* Advances the tape to the specified image index and returns a Promise
    that will resolve when tape motion completes */

    return new Promise((resolve, reject) => {
        var len = index - this.imgIndex;    // number of words passed
        var delay = len*this.millisPerWord; // amount of tape spin time

        this.imgIndex = index;
        this.moveTape(len*this.inchesPerWord, delay, resolve, result);
    });
};

/**************************************/
B220MagTapeDrive.prototype.loadTape = function loadTape() {
    /* Loads a tape into memory based on selections in the MTLoad window */
    var $$$ = null;                     // getElementById shortcut for loader window
    var doc = null;                     // loader window.document
    var file = null;                    // FileReader instance
    var fileSelect = null;              // file picker element
    var mt = this;                      // this B220MagTapeDrive instance
    var win = this.window.open("B220MagTapeLoadPanel.html", this.mnemonic + "Load",
            "location=no,scrollbars=no,resizable,width=508,height=112,left=" +
            (this.window.screenX+16) +",top=" + (this.window.screenY+16));

    function fileSelector_onChange(ev) {
        /* Handle the <input type=file> onchange event when a file is selected */
        var fileName;
        var x;

        file = ev.target.files[0];
        fileName = file.name;
        $$$("MTLoadWriteEnableCheck").checked = false;
    }

    function finishLoad() {
        /* Finishes the tape loading process and closes the loader window */
        var x;

        mt.notWrite = !$$$("MTLoadWriteEnableCheck").checked;
        mt.notWriteLamp.set(mt.notWrite ? 1 : 0);
        mt.reelBar.max = mt.maxTapeInches;
        mt.reelBar.value = mt.maxTapeInches;
        mt.setAtBOT(true);
        mt.setAtEOT(false);
        mt.tapeState = mt.tapeLocal;    // setTapeReady() requires it not be unloaded
        mt.setLane(0, null);
        mt.$$("MTLaneNrLight").style.visibility = "visible";
        mt.setTapeReady(true);
        mt.reelIcon.style.visibility = "visible";
        B220Util.removeClass(mt.$$("MTUnloadedLight"), "annunciatorLit");
    }

    function writeBlockStart(length) {
        /* Writes the start-of-block words to the tape image buffer in the current
        lane number and at the current offset of mt.imgIndex: 3 gap words + the
        preface word with the binary block length */
        var x;

        for (x=0; x<mt.startOfBlockWords-1; ++x) {
            mt.image[mt.laneNr][mt.imgIndex+x] = mt.markerGap;
        }

        mt.image[mt.laneNr][mt.imgIndex+x] = length;  // preface word
        mt.imgIndex += mt.startOfBlockWords;
    }

    function writeBlockEnd() {
        /* Writes the start-of-block words to the tape image buffer at the current
        value of mt.imgIndex: 3 gap words + the preface word with the binary block
        length */
        var x;

        for (x=0; x<mt.endOfBlockWords; ++x) {
            mt.image[mt.laneNr][mt.imgIndex+x] = mt.markerEOB;
        }

        mt.imgIndex += mt.endOfBlockWords;
    }

    function writeEndOfTapeBlock(controlWord) {
        /* Writes an end-of-tape block containing the designated controlWord */
        var x;

        writeBlockStart(1);
        mt.image[mt.laneNr][mt.imgIndex++] = controlWord;
        for (x=0; x<9; ++x) {
            mt.image[mt.laneNr][mt.imgIndex+x] = 0;
        }

        mt.imgIndex += 9;
        writeBlockEnd();
    }

    function editedLoader() {
        /* Loads an edited (blank) tape image into the drive. If a block length
        was chosen on the tape-load panel, initializes the image with blocks of
        that size, followed by an end-of-tape block in both lanes having the
        controlWord (aaaa=0000, bbbb=0001) */
        var blockLen;
        var fmt = $$$("MTLoadFormatSelect").selectedIndex;
        var lane;
        var x;

        if (fmt <= 0) {
            mt.$$("MTFileName").value = "(Edited tape)";
        } else {
            blockLen = fmt*10;          // words/block
            mt.$$("MTFileName").value = "(Formatted as " + blockLen.toFixed(0) + "-word blocks)";
            for (mt.laneNr=0; mt.laneNr<2; ++mt.laneNr) {
                lane = mt.image[mt.laneNr];
                mt.imgIndex = mt.magBOTWords;
                while (lane[mt.imgIndex] != mt.markerMagEOT) {
                    writeBlockStart(blockLen);
                    for (x=0; x<blockLen; ++x) {
                        lane[mt.imgIndex+x] = 0;
                    }

                    mt.imgIndex += blockLen;
                    writeBlockEnd();
                } // while

                writeEndOfTapeBlock(0x00000001); // aaaa=0000, bbbb=0001

                // Write a gap so that MPE can sense end-of-info.
                for (x=0; x<mt.startOfBlockWords*2; ++x) {
                    lane[mt.imgIndex+x] = mt.markerGap;
                }
                mt.imgIndex += mt.startOfBlockWords*2;
           }  // for mt.laneNr
        }

        mt.imgTopWordNr = mt.imgIndex;
        mt.imgWritten = false;
        finishLoad();
    }

    function textLoader_onload(ev) {
        /* Event handler for tape image file onLoad. Loads a text image as
        comma-delimited decimal word values. No end-of-tape block is written
        unless it is present in the text image */
        var blockWords;                 // words in current tape block
        var chunk;                      // ANSI text of current chunk
        var chunkLength;                // length of current ASCII chunk
        var buf = ev.target.result;     // ANSI tape image buffer
        var bufLength = buf.length;     // length of ANSI tape image buffer
        var dups;                       // repeat factor for consecutive blocks
        var eolRex = /([^\n\r\f]*)((:?\r[\n\f]?)|\n|\f)?/g;
        var index = 0;                  // char index into tape image buffer for next chunk
        var lane;                       // current tape lane image
        var lx = [0,0];                 // word indexes for each lane
        var match;                      // result of eolRex.exec()
        var preface;                    // preface word: block length in words
        var repeatRex = /\s*(\d+)\s*\*\s*/; // regex to detect and parse repeat factor
        var tx;                         // char index into ANSI chunk text
        var wx;                         // word index within current block

        function parseRepeatFactor() {
            /* Parses the repeat factor, if any, from the first field on the
            line and returns its value. If there is no repeat factor, returns 1.
            Leaves "tx" (the index into the line) pointing to the lane number */
            var match;                  // result of regex match
            var v;                      // parsed numeric value

            match = repeatRex.exec(chunk);
            if (!match) {
                v = 1;                  // default if no repeat present
            } else {
                tx += match[0].length;
                v = parseInt(match[1], 10);
                if (isNaN(v)) {
                    v = 1;              // default if repeat is non-numeric
                }
            }

            return v;
        }

        function parseWord(radix) {
            /* Parses the next word from the chunk text and returns its value as
            determined by "radix" */
            var cx;                     // offset to next comma
            var text;                   // text of parsed word
            var v;                      // parsed numeric value
            var w = 0;                  // result BCD word

            if (tx < chunkLength) {
                cx = chunk.indexOf(",", tx);
                if (cx < 0) {
                    cx = chunkLength;
                }
                text = chunk.substring(tx, cx).trim();
                if (text.length > 0) {
                    v = parseInt(text, radix);
                    if (!isNaN(v)) {
                        if (v > 0) {
                            w = v % 0x100000000000;
                        } else if (v < 0) {
                            // The number was specified as negative: if the
                            // sign bit is not already set, then set it.
                            w = (-v) % 0x100000000000;
                            if (w % 0x20000000000 < 0x10000000000) {
                                w += 0x10000000000;
                            }
                        }
                    }
                }

                tx = cx+1;
            }

            return w;
        }

        lx[0] = lx[1] = mt.magBOTWords;
        do {
            eolRex.lastIndex = index;
            match = eolRex.exec(buf);
            if (!match) {
                break;
            } else {
                index += match[0].length;
                chunk = match[1].trim();
                chunkLength = chunk.length;
                if (chunkLength > 0) {  // ignore empty lines
                    tx = 0;
                    dups = parseRepeatFactor();         // get the repeat factor, if any
                    mt.laneNr = parseWord(10)%2;        // get the lane number
                    preface = parseWord(10);            // get the preface word as decimal
                    if (preface > 100) {                // limit blocks to 100 words
                        preface = 100;
                    } else if (preface < 1) {           // if block length <= 0, make it 100
                        preface = 100;
                    }

                    blockWords = (preface == 1 ? 10 : preface); // pad out end-of-tape blocks to 10 words
                    lane = mt.image[mt.laneNr];
                    mt.imgIndex = lx[mt.laneNr];        // restore internal offset for this lane

                    writeBlockStart(preface);
                    wx = 0;                             // load data words from tape image
                    while (tx < chunkLength && wx < preface) {
                        lane[mt.imgIndex+wx] = parseWord(16);
                        ++wx;
                    } // while tx:wx

                    while (wx < blockWords) {           // pad block with zero words, if needed
                        lane[mt.imgIndex+wx] = 0;
                        ++wx;
                    } // while wx

                    mt.imgIndex += blockWords;          // update the internal image offset
                    writeBlockEnd();

                    wx = lx[mt.laneNr];                 // starting offset of block
                    blockWords = mt.imgIndex - wx;      // total words in block, including overhead
                    while (dups > 1) {                  // repeat the block as necessary
                        --dups;
                        lane.copyWithin(mt.imgIndex, wx, wx+blockWords);
                        mt.imgIndex += blockWords;
                    } // while dups

                    lx[mt.laneNr] = mt.imgIndex;        // save current offset for this lane
                }
            }
        } while (index < bufLength);

        // Write a gap at the end of both lanes so that MPE can sense end-of-info.
        for (mt.laneNr=0; mt.laneNr<2; ++mt.laneNr) {
            lane = mt.image[mt.laneNr];
            mt.imgIndex = lx[mt.laneNr];
            for (wx=0; wx<mt.startOfBlockWords*2; ++wx) {
                lane[mt.imgIndex+wx] = mt.markerGap;
            } // for wx

            lx[mt.laneNr] = mt.imgIndex + mt.startOfBlockWords*2;
        } // for mt.laneNr

        mt.imgTopWordNr = Math.max(lx[0], lx[1]);
        mt.imgWritten = false;
        finishLoad();
    }

    function tapeLoadRemoveEvents() {
        /* Removes the event listeners for the tape load window */

        fileSelect.removeEventListener("change", fileSelector_onChange, false);
        $$$("MTLoadFormatSelect").removeEventListener("change", selectFormat_onChange, false);
        $$$("MTLoadOKBtn").removeEventListener("click", tapeLoadOK, false);
        $$$("MTLoadCancelBtn").removeEventListener("click", tapeLoadCancel, false);
    }

    function selectFormat_onChange(ev) {
        /* Handler for the onChange event of the format selection list */

        $$$("MTLoadWriteEnableCheck").checked = (ev.target.selectedIndex > 0);
    }

    function tapeLoadOK(ev) {
        /* Handler for the load window's OK button. Does the actual tape load.
        If a tape-image file has been selected, loads that file; otherwise loads
        a blank tape */
        var tape;
        var top;
        var x;

        // Allocate the tape image buffer
        mt.image = [new Float64Array(mt.maxTapeWords),          // lane 0
                    new Float64Array(mt.maxTapeWords)];         // lane 1

        // Initialize the magnetic beginning-of-tape area
        for (x=0; x<mt.magBOTWords; ++x) {
            mt.image[0][x] = mt.markerFlaw;
            mt.image[1][x] = mt.markerFlaw;
        }

        // Initialize the bulk of the tape as blank (erased) space
        mt.imgIndex = mt.magBOTWords;
        mt.imgLength = mt.maxTapeWords;
        top = mt.imgLength - mt.magEOTWords;
        for (x=mt.imgIndex; x<top; ++x) {
            mt.image[0][x] = mt.markerGap;
            mt.image[1][x] = mt.markerGap;
        }

        // Initialize the magnetic end-of-tape area
        for (x=top; x<mt.imgLength; ++x) {
            mt.image[0][x] = mt.markerMagEOT;
            mt.image[1][x] = mt.markerMagEOT;
        }

        // Load the tape image, if any
        if (!file) {
            editedLoader();
        } else {
            mt.$$("MTFileName").value = file.name;
            tape = new FileReader();
            tape.onload = textLoader_onload;
            tape.readAsText(file);
        }

        win.close();
        tapeLoadRemoveEvents();
    }

    function tapeLoadCancel(ev) {
        /* Handler for the load window's Cancel button */

        file = null;
        mt.$$("MTFileName").value = "";
        win.close();
        tapeLoadRemoveEvents();
    }

    function tapeLoadOnload(ev) {
        /* Driver for the tape loader window */
        var de;

        doc = win.document;
        doc.title = "retro-220 " + mt.mnemonic + " Tape Loader";
        de = doc.documentElement;
        $$$ = function $$$(id) {
            return doc.getElementById(id);
        };

        win.removeEventListener("load", tapeLoadOnload, false);

        fileSelect = $$$("MTLoadFileSelector");
        fileSelect.addEventListener("change", fileSelector_onChange, false);

        $$$("MTLoadFormatSelect").addEventListener("change", selectFormat_onChange, false);
        $$$("MTLoadOKBtn").addEventListener("click", tapeLoadOK, false);
        $$$("MTLoadCancelBtn").addEventListener("click", tapeLoadCancel, false);

        win.focus();
        win.resizeBy(de.scrollWidth - win.innerWidth,
                     de.scrollHeight - win.innerHeight);
    }

    function tapeLoadUnload(ev) {
        win.removeEventListener("unload", tapeLoadUnload, false);
        mt.loadWindow = null;
    }

    // Outer block of loadTape
    if (this.loadWindow && !this.loadWindow.closed) {
        this.loadWindow.close();
    }
    this.loadWindow = win;
    win.addEventListener("load", tapeLoadOnload, false);
    win.addEventListener("unload", tapeLoadUnload, false);
};

/**************************************/
B220MagTapeDrive.prototype.unloadTape = function unloadTape() {
    /* Reformats the tape image data as ASCII text and displays it in a new
    window so the user can save or copy/paste it elsewhere */
    var doc = null;                     // loader window.document
    var image;                          // <pre> element to receive tape image data
    var mt = this;                      // tape drive object
    var win = this.window.open("./B220FramePaper.html", this.mnemonic + "-Unload",
            "location=no,scrollbars=yes,resizable,width=800,height=600");

    function findBlockStart() {
        /* Searches forward in the tape image on the currently-selected lane for the
        start of a block or magnetic end-of-tape markers, or physical end-of-tape,
        whichever occurs first. If an inter-block (blank) gap word is found, skips
        over all of them and reads the preface word. Returns the preface word, or
        the magnetic EOT marker (-3) word, or if physical EOT is encountered, an
        inter-block gap (-1) word */
        var imgLength = mt.imgLength;   // physical end of tape index
        var lane = mt.image[mt.laneNr]; // image data for current lane
        var result = mt.markerGap;      // function result
        var state = 1;                  // FSA state variable
        var w;                          // current image word
        var x = mt.imgIndex;            // lane image word index

        while (x < imgLength) {
            w = lane[x++];
            switch (state) {
            case 1: // search for inter-block gap word
                if (w == mt.markerGap) {
                    state = 2;
                } else if (w == mt.markerMagEOT) {
                    result = w;             // return the EOT word
                    mt.imgIndex = x-1;      // point to EOT word
                    x = imgLength;          // kill the loop
                }
                break;

            case 2: // search for preface word
                if (w >= 0) {
                    result = w;             // found preface, return it
                    mt.imgIndex = x;        // point to first data word in block
                    x = imgLength;          // kill the loop
                } else if (w != mt.markerGap) {
                    result = w;             // return whatever marker word was found
                    mt.imgIndex = x-1;      // point to the word found
                    x = imgLength;          // kill the loop
                }
                break;

            default:
                x = imgLength;              // kill the loop
                throw new Error("Invalid state: B220MagTapeDrive.unloadTape.findBlockStart, " + state);
                break;
            } // switch state
        } // while x

        return result;
    }

    function unloadDriver() {
        /* Converts the tape image to ASCII once the window has displayed the
        waiting message */
        var buf;                        // ANSI tape image buffer
        var dups = 0;                   // block repeat count
        var imgLength = mt.imgLength;   // active words in tape image
        var imgTop = mt.imgTopWordNr;   // tape image last block number
        var lane;                       // lane image buffer
        var lastBuf = "";               // last block image output
        var lx;                         // lane index
        var nzw;                        // number of consecutive zero words
        var state;                      // lane processing state variable
        var w;                          // current image word
        var wx;                         // word index within block
        var x = 0;                      // image data index

        while (image.firstChild) {      // delete any existing <pre> content
            image.removeChild(image.firstChild);
        }

        for (lx=0; lx<2; ++lx) {
            mt.laneNr = lx;
            lane = mt.image[lx];
            state = 1;
            x = 0;
            do {
                switch (state) {
                case 1: // Search for start of block
                    nzw = 0;
                    mt.imgIndex = x;
                    w = findBlockStart();
                    if (w < 0) {        // done with this lane
                        x = imgLength;  // kill the loop
                    } else {            // format the lane number and preface word
                        buf = lx.toString(10) + "," + w.toString(10);
                        x = mt.imgIndex;
                        state = 2;      // switch state to blocking data words
                    }
                    break;
                case 2: // Record the block data words
                    w = lane[x++];
                    if (w == 0) {       // suppress trailing zero words
                        ++nzw;
                    } else if (w >= 0) {// buffer the current word
                        while (nzw > 0) {
                            --nzw;              // restore non-trailing zero words
                            buf += ",0";
                        }
                        buf += "," + w.toString(16);
                    } else {            // output the last block image(s)
                        state = 1;              // reset state for next block
                        if (buf == lastBuf) {   // compress consecutive duplicate blocks
                            ++dups;
                        } else {
                            if (dups > 1) {
                                image.appendChild(doc.createTextNode(dups.toString(10) + "*" + lastBuf + "\n"));
                            } else if (dups > 0) {
                                image.appendChild(doc.createTextNode(lastBuf + "\n"));
                            }

                            lastBuf = buf;
                            dups = 1;
                        }
                    }
                    break;
                default:
                    x = imgLength;      // kill the loop
                    throw new Error("Invalid state: B220MagTapeDrive.unloadTape, " + state);
                    break;
                } // switch state
            }  while (x < imgLength);

            // Output the final block(s) for the lane.
            if (dups > 1) {
                image.appendChild(doc.createTextNode(dups.toString(10) + "*" + lastBuf + "\n"));
            } else if (dups > 0) {
                image.appendChild(doc.createTextNode(lastBuf + "\n"));
            }

            dups = 0;
            lastBuf = "";
        } // for lx

        mt.setTapeUnloaded();
    }

    function unloadSetup() {
        /* Loads a status message into the "paper" rendering area, then calls
        unloadDriver after a short wait to allow the message to appear */

        win.removeEventListener("load", unloadSetup, false);
        doc = win.document;
        doc.title = "retro-220 " + mt.mnemonic + " Unload Tape";
        image = doc.getElementById("Paper");
        image.appendChild(win.document.createTextNode(
                "Rendering tape image... please wait..."));
        setTimeout(unloadDriver, 50);
    }

    // Outer block of unloadTape
    win.moveTo((screen.availWidth-win.outerWidth)/2, (screen.availHeight-win.outerHeight)/2);
    win.focus();
    win.addEventListener("load", unloadSetup, false);
};

/**************************************/
B220MagTapeDrive.prototype.LoadBtn_onclick = function LoadBtn_onclick(ev) {
    /* Handle the click event for the LOAD button */

    if (!this.busy && !this.powerOn && this.tapeState == this.tapeUnloaded) {
        this.loadTape();
    }
};

/**************************************/
B220MagTapeDrive.prototype.UnloadBtn_onclick = function UnloadBtn_onclick(ev) {
    /* Handle the click event for the UNLOAD button */

    if (!this.busy && this.atBOT && !this.powerOn && this.tapeState == this.tapeLocal) {
        if (this.imgWritten && this.window.confirm(
                "Do you want to save the tape image data?\n(CANCEL discards the image)")) {
            this.unloadTape();          // it will do setTapeUnloaded() afterwards
        } else {
            this.setTapeUnloaded();
        }
    }
};

/**************************************/
B220MagTapeDrive.prototype.RewindBtn_onclick = function RewindBtn_onclick(ev) {
    /* Handle the click event for the REWIND button */

    if (!this.busy && !this.powerOn && this.tapeState != this.tapeUnloaded) {
        this.tapeRewind(this.laneNr, this.rewindLock)
        .then(this.boundReleaseUnit)
        .then(this.tcu.boundTapeUnitFinished);
    }
};

/**************************************/
B220MagTapeDrive.prototype.UnitDesignate_onchange = function UnitDesignate_onchange(ev) {
    /* Handle the change event for the UNIT DESIGNATE select list */
    var prefs = this.config.getNode("MagTape.units", this.unitIndex);
    var sx = ev.target.selectedIndex;

    this.setUnitDesignate(sx);
    prefs.designate = sx;
    this.setTapeReady(this.remote);
    this.config.putNode("MagTape.units", prefs, this.unitIndex);
};

/**************************************/
B220MagTapeDrive.prototype.RWLRBtn_onclick = function RWLRBtn_onclick(ev) {
    /* Handle the click event for the RWLR (Rewind-Lock-Release) button */

    this.rewindLock = false;
    this.rwlLamp.set(0);
    this.setTapeReady(true);
};

/**************************************/
B220MagTapeDrive.prototype.WriteBtn_onclick = function WriteBtn_onclick(ev) {
    /* Handle the click event for the WRITE and NOT WRITE buttons */

    this.notWrite = (ev.target.id == "NotWriteBtn");
    this.notWriteLamp.set(this.notWrite ? 1 : 0);
};

/**************************************/
B220MagTapeDrive.prototype.TransportOnBtn_onclick = function TransportOnBtn_onclick(ev) {
    /* Handle the click event for the TRANSPORT POWER ON and STANDBY buttons */

    this.powerOn = (ev.target.id == "TransportOnBtn") && (this.tapeState != this.tapeUnloaded);
    this.transportOnLamp.set(this.powerOn ? 1 : 0);
    this.transportStandbyLamp.set(this.powerOn ? 0 : 1);
    this.setTapeReady(this.powerOn);
};

/**************************************/
B220MagTapeDrive.prototype.beforeUnload = function beforeUnload(ev) {
    var msg = "Closing this window will make the device unusable.\n" +
              "Suggest you stay on the page and minimize this window instead";

    ev.preventDefault();
    ev.returnValue = msg;
    return msg;
};

/**************************************/
B220MagTapeDrive.prototype.tapeDriveOnload = function tapeDriveOnload() {
    /* Initializes the reader window and user interface */
    var body;
    var prefs = this.config.getNode("MagTape.units", this.unitIndex);

    this.doc = this.window.document;
    this.doc.title = "retro-220 Tape Drive " + this.mnemonic;

    body = this.$$("MTDiv");
    this.reelBar = this.$$("MTReelBar");
    this.reelIcon = this.$$("MTReel");

    this.rwlLamp = new ColoredLamp(body, null, null, "RWLLamp", "blueLamp lampCollar", "blueLit");
    this.notWriteLamp = new ColoredLamp(body, null, null, "NotWriteLamp", "blueLamp lampCollar", "blueLit");
    this.notReadyLamp = new ColoredLamp(body, null, null, "NotReadyLamp", "blueLamp lampCollar", "blueLit");
    this.designatedLamp = new ColoredLamp(body, null, null, "DesignatedLamp", "blueLamp lampCollar", "blueLit");
    this.transportOnLamp = new ColoredLamp(body, null, null, "TransportOnLamp", "blueLamp lampCollar", "blueLit");
    this.transportStandbyLamp = new ColoredLamp(body, null, null, "TransportStandbyLamp", "blueLamp lampCollar", "blueLit");

    this.transportStandbyLamp.set(1);

    this.unitDesignateList = this.$$("UnitDesignate");
    this.unitDesignateList.selectedIndex = prefs.designate;
    this.setUnitDesignate(prefs.designate);

    this.tapeState = this.tapeLocal;    // setTapeUnloaded() requires it to be in local
    this.atBOT = true;                  // and also at BOT
    this.setTapeUnloaded();

    this.window.addEventListener("beforeunload",
            B220MagTapeDrive.prototype.beforeUnload, false);
    this.$$("LoadBtn").addEventListener("click",
            B220MagTapeDrive.prototype.LoadBtn_onclick.bind(this), false);
    this.$$("UnloadBtn").addEventListener("click",
            B220MagTapeDrive.prototype.UnloadBtn_onclick.bind(this), false);
    this.$$("RewindBtn").addEventListener("click",
            B220MagTapeDrive.prototype.RewindBtn_onclick.bind(this), false);
    this.unitDesignateList.addEventListener("change",
            B220MagTapeDrive.prototype.UnitDesignate_onchange.bind(this), false);
    this.$$("RWLRBtn").addEventListener("click",
            B220MagTapeDrive.prototype.RWLRBtn_onclick.bind(this), false);
    this.$$("WriteBtn").addEventListener("click",
            B220MagTapeDrive.prototype.WriteBtn_onclick.bind(this), false);
    this.$$("NotWriteBtn").addEventListener("click",
            B220MagTapeDrive.prototype.WriteBtn_onclick.bind(this), false);
    this.$$("TransportOnBtn").addEventListener("click",
            B220MagTapeDrive.prototype.TransportOnBtn_onclick.bind(this), false);
    this.$$("TransportStandbyBtn").addEventListener("click",
            B220MagTapeDrive.prototype.TransportOnBtn_onclick.bind(this), false);
};

/**************************************/
B220MagTapeDrive.prototype.startUpForward = function startUpForward(driveState) {
    /* Initializes the I/O in a forward direction and provides the start-up
    delay for drive acceleration. Returns a Promise that resolves at completion
    of the start-up acceleration */

    if (this.busy) {
        driveState.state = driveState.driveBusy;
        return Promise.reject(driveState);
    } else if (!this.ready || this.rewindLock) {
        driveState.state = driveState.driveNotReady;
        return Promise.reject(driveState);
    } else if (this.atEOT) {
        driveState.state = driveState.driveAtEOT;
        return Promise.reject(driveState);
    } else {
        return new Promise((resolve, reject) => {
            this.busy = true;
            this.designatedLamp.set(1);
            this.setAtBOT(false);
            this.imgIndex += this.startWords;
            driveState.completionDelay -= this.startTime;
            setCallback(this.mnemonic, this, this.startTime, resolve, driveState);
            this.moveTape(this.startWords*this.inchesPerWord, this.startTime, resolve, driveState);
        });
    }
};

/**************************************/
B220MagTapeDrive.prototype.startUpBackward = function startUpBackward(driveState) {
    /* Initializes the I/O in a backward direction and provides the start-up
    delay for drive acceleration */

    if (this.busy) {
        driveState.state = driveState.driveBusy;
        return Promise.reject(driveState);
    } else if (!this.ready || this.rewindLock) {
        driveState.state = driveState.driveNotReady;
        return Promise.reject(driveState);
    } else if (this.atBOT) {
        driveState.state = driveState.driveAtBOT;
        return Promise.reject(driveState);
    } else {
        return new Promise((resolve, reject) => {
            this.busy = true;
            this.designatedLamp.set(1);
            this.setAtEOT(false);
            this.imgIndex -= this.startWords;
            driveState.completionDelay -= this.startTime;
            setCallback(this.mnemonic, this, this.startTime, resolve, driveState);
            this.moveTape(-this.startWords*this.inchesPerWord, this.startTime, resolve, driveState);
        });
    }
};

/**************************************/
B220MagTapeDrive.prototype.reverseDirection = function reverseDirection(driveState) {
    /* Generates a delay to allow the drive to stop and reverse direction.
    Returns a Promise that resolves when the delay is complete */

    return new Promise((resolve, reject) => {
        setCallback(this.mnemonic, this, this.turnaroundTime, resolve, driveState);
    });
};

/**************************************/
B220MagTapeDrive.prototype.reposition = function reposition(driveState) {
    /* Reverses tape direction after a forward tape operation and repositions
    the head five words from the end of the prior block, giving room for
    startup acceleration of the next forward operation. The "prior block" is
    located by the first EOB (erase gap) or flaw marker word encountered when
    moving in a backward direction. Returns a Promise that resolves when tape
    motion is complete.

    A real 220 drive repositioned tape about 60 digits (five words) from the end
    of the data portion of the block, to allow for tape acceleration of about
    3ms, at which point it took about 2ms (50 digits, or just over four words)
    to reach the end of the erase gap and start of the inter-block gap for the
    next block. this.repositionWords is sized to approximate the 3ms
    acceleration delay */

    return new Promise((resolve, reject) => {
        var lane = this.image[this.laneNr]; // image data for current lane
        var state = 1;                      // FSA state variable
        var x = this.imgIndex-1;            // lane image word index (start with prior word)

        do {
            if (x <= 0) {
                state = 0;                  // at BOT
            } else {
                switch (state) {
                case 1: // initial state: skip backwards until erase-gap or BOT flaw-marker words
                    if (lane[x] == this.markerEOB) {
                        --x;
                        state = 2;
                    } else if (lane[x] == this.markerFlaw) {
                        state = 0;
                    } else {
                        --x;
                    }
                    break;
                case 2: // skip backwards over erase-gap words
                    if (lane[x] == this.markerEOB) {
                        --x;
                    } else {
                        state = 0;
                    }
                    break;
                } // switch state
            }
        } while (state);

        x = this.imgIndex - x + this.repositionWords;       // words to reposition
        if (x < this.imgIndex) {
            this.imgIndex -= x;
        } else {
            x = this.imgIndex;
            this.imgIndex = 0;
            driveState.state = driveState.driveAtBOT;
            this.setAtBOT(true);
        }

        driveState.completionDelay -= this.turnaroundTime;
        this.moveTape(-x*this.inchesPerWord, this.turnaroundTime, resolve, driveState);
    });
};

/**************************************/
B220MagTapeDrive.prototype.scanBlock = function scanBlock(driveState, wordIndex) {
    /* Scans one block in a forward direction. Terminates with either the control
    word from an EOT or control block, or the category word from any other block
    stored in the "driveState" structure. "wordIndex" is the 1-relative index
    of the category word to match. Returns a Promise that resolves at the end
    of the block scan. This routine is used for MTC and MFC */

    var scanForward = (resolve, reject) => {
        /* Reads the start of the next block in the tape image in a forward
        direction to obtain its category word */
        var count = 0;                  // word counter within block
        var imgLength = this.imgLength; // physical end of tape index
        var lane = this.image[this.laneNr]; // image data for current lane
        var preface = 0;                // block length read from tape image
        var sign = 0;                   // sign digit of keyword
        var state = 1;                  // FSA state variable
        var w = 0;                      // current image word
        var x = this.imgIndex;          // lane image word index

        do {
            if (x >= imgLength) {
                state = 0;              // at EOT: just exit and leave the control hanging...
                driveState.state = driveState.driveAtEOT;
                this.moveTapeTo(x, driveState).then(this.boundSetEOT);
            } else {
                w = lane[x];
                switch (state) {
                case 1: // initial state: skip over flaw and intra-block words
                    if (w == this.markerGap) {
                        ++x;
                        state = 2;
                    } else {
                        ++x;
                    }
                    break;

                case 2: // skip over inter-block gap and magnetic EOT words
                    if (w == this.markerGap) {
                        ++x;
                    } else if (w == this.markerMagEOT) {
                        ++x;
                    } else if (w >= 0) {
                        state = 3;      // found the preface
                    } else {
                        state = 0;      // not a formatted tape
                        driveState.state = driveState.drivePrefaceCheck;
                        reject(this.moveTapeTo(x, driveState));
                    }
                    break;

                case 3: // read the preface and check for EOT block
                    ++x;
                    preface = w;
                    if (preface == 1) {
                        state = 6;      // detected end-of-tape block
                    } else if (preface < this.minBlockWords && preface > 1) {
                        state = 0;      // invalid preface on tape
                        driveState.state = driveState.drivePrefaceCheck;
                        reject(this.moveTapeTo(x, driveState));
                    } else {
                        state = 4;      // normal or control block
                    }
                    break;

                case 4: // read keyword, detect control block, do not advance beyond keyword (yet)
                    if (w < 0) {
                        state = 0;      // preface/block-length mismatch
                        driveState.state = driveState.driveReadCheck;
                        reject(this.moveTapeTo(x-1, driveState).then(this.boundReposition));
                    } else {
                        sign = (w - w%0x10000000000)/0x10000000000;
                        if (sign == 7) {
                            state = 6;  // detected control block
                        } else {
                            state = 5;  // normal block
                        }
                    }
                    break;

                case 5: // read the block words and capture the category word
                    if (w < 0) {
                        state = 0;  // preface/block-length mismatch
                        driveState.state = driveState.driveReadCheck;
                        reject(this.moveTapeTo(x-1, driveState).then(this.boundReposition));
                    } else {
                        ++count;
                        ++x;
                        if (count >= wordIndex) {
                            driveState.keyword = w;     // return category word to the TCU
                            state = 7;                  // finish the block
                        }
                    }
                    break;

                case 6: // handle an end-of-tape or control block
                    if (w < 0) {
                        state = 0;      // block was shorter than preface indicated
                        driveState.state = driveState.driveReadCheck;
                        reject(this.moveTapeTo(x-1, driveState).then(this.boundReposition));
                    } else {
                        driveState.state = driveState.driveHasControlWord;
                        driveState.controlWord = w;     // not used by the TCU
                        ++x;
                        state = 7;
                    }
                    break;

                case 7: // step through remaining words in the block until normal EOB
                    if (w == this.markerEOB) {
                        ++x;
                        state = 8;
                    } else {
                        ++x;
                    }
                    break;

                case 8: // step through erase-gap words and finish normally
                    if (w == this.markerEOB) {
                        ++x;
                    } else {
                        state = 0;
                        resolve(this.moveTapeTo(x, driveState));
                    }
                    break;
                } // switch state
            }
        } while (state);
    }

    if (!this.ready || this.atEOT) {
        driveState.state = driveState.driveNotReady;
        return Promise.reject(driveState);
    } else {
        return new Promise(scanForward);
    }
};

/**************************************/
B220MagTapeDrive.prototype.searchForwardBlock = function searchForwardBlock(driveState) {
    /* Searches one block in a forward direction. Terminates with either the
    control word from an EOT block or the keyword from any other block stored
    in the "driveState" structure. Returns a Promise that resolves at the end
    of the block search. This routine is used for MTS and MFS */

    var searchForward = (resolve, reject) => {
        /* Reads the start of the next block in the tape image in a forward
        direction to obtain its keyword, leaving the tape positioned after
        the keyword */
        var imgLength = this.imgLength; // physical end of tape index
        var lane = this.image[this.laneNr]; // image data for current lane
        var preface = 0;                // block length read from tape image
        var state = 1;                  // FSA state variable
        var w = 0;                      // current image word
        var x = this.imgIndex;          // lane image word index

        do {
            if (x >= imgLength) {
                state = 0;              // at EOT: just exit and leave the control hanging...
                driveState.state = driveState.driveAtEOT;
                this.moveTapeTo(x, driveState).then(this.boundSetEOT);
            } else {
                w = lane[x];
                switch (state) {
                case 1: // initial state: skip over flaw and intra-block words
                    if (w == this.markerGap) {
                        ++x;
                        state = 2;
                    } else {
                        ++x;
                    }
                    break;

                case 2: // skip over inter-block gap and magnetic EOT words
                    if (w == this.markerGap) {
                        ++x;
                    } else if (w == this.markerMagEOT) {
                        ++x;
                    } else if (w >= 0) {
                        state = 3;      // found the preface
                    } else {
                        state = 0;      // not a formatted tape
                        driveState.state = driveState.drivePrefaceCheck;
                        reject(this.moveTapeTo(x, driveState));
                    }
                    break;

                case 3: // read the preface and check for EOT block
                    ++x;
                    preface = w;
                    if (preface == 1) {
                        state = 5;      // detected end-of-tape block
                    } else if (preface < this.minBlockWords && preface > 1) {
                        state = 0;      // invalid preface on tape
                        driveState.state = driveState.drivePrefaceCheck;
                        reject(this.moveTapeTo(x, driveState));
                    } else {
                        state = 4;      // normal or control block
                    }
                    break;

                case 4: // read the keyword and finish
                    if (w < 0) {
                        state = 0;      // preface/block-length mismatch
                        driveState.state = driveState.driveReadCheck;
                        reject(this.moveTapeTo(x-1, driveState).then(this.boundReposition));
                    } else {
                        state = 0;      // finish the block
                        driveState.keyword = w;
                        resolve(this.moveTapeTo(x+this.repositionWords, driveState));
                    }
                    break;

                case 5: // handle an end-of-tape block and finish
                    if (w < 0) {
                        state = 0;      // block was shorter than preface indicated
                        driveState.state = driveState.driveReadCheck;
                        reject(this.moveTapeTo(x-1, driveState).then(this.boundReposition));
                    } else {
                        state = 0;      // finish the block
                        driveState.state = driveState.driveHasControlWord;
                        driveState.controlWord = w;     // not used by the TCU
                        resolve(this.moveTapeTo(x+this.repositionWords, driveState));
                    }
                    break;
                } // switch
            }
        } while (state);
    }

    if (!this.ready || this.atEOT) {
        driveState.state = driveState.driveNotReady;
        return Promise.reject(driveState);
    } else {
        return new Promise(searchForward);
    }
};

/**************************************/
B220MagTapeDrive.prototype.searchBackwardBlock = function searchBackwardBlock(driveState) {
    /* Searches one block in a backward direction. Terminates with the keyword
    from block stored in the "driveState" structure. Returns a Promise that
    resolves at the end of the block search. This routine is used for MTS and
    MFS */

    var searchBackward = (resolve, reject) => {
        /* Reads the start of the next block in the tape image in a backward
        direction to obtain its keyword, leaving the tape positioned in the
        prior block */
        var count = 0;                  // contiguous block data word counter
        var imgLength = this.imgLength; // physical end of tape index
        var keyword = 0;                // keyword from block
        var lane = this.image[this.laneNr]; // image data for current lane
        var preface = 0;                // block length read from tape image
        var state = 1;                  // FSA state variable
        var w = 0;                      // current image word
        var x = this.imgIndex-1;        // lane image word index (start with prior word)

        do {
            if (x <= 0) {
                state = 0;                      // at BOT: just exit and leave the control hanging...
                driveState.state = driveState.driveAtBOT;
                this.moveTapeTo(x, driveState).then(this.boundSetBOT);
            } else {
                w = lane[x];
                switch (state) {
                case 1: // initial state: skip over flaw and magnetic EOT words
                    if (w == this.markerGap) {
                        --x;
                        state = 2;
                    } else if (w == this.markerFlaw) {
                        --x;
                    } else if (w == this.markerMagEOT) {
                        --x;
                    } else {
                        state = 3;
                    }
                    break;

                case 2: // skip initial inter-block gap words
                    if (w == this.markerGap) {
                        --x;
                    } else {
                        state = 3;
                    }
                    break;

                case 3: // search for start of block (first prior inter-block gap word)
                    if (w == this.markerGap) {
                        --x;
                        state = 4;
                    } else if (w < 0) {
                        count = 0;
                        --x;
                    } else {
                        keyword = preface;      // remember the last two words we've seen
                        preface = w;
                        --x;
                        ++count;
                    }
                    break;

                case 4: // skip this block's inter-block gap words
                    if (w == this.markerGap) {
                        --x;
                    } else {
                        state = 5;
                    }
                    break;

                case 5: // skip the prior block's erase-gap words, store the keyword, and then quit
                    if (w == this.markerEOB) {
                        --x;
                    } else if (count < 2) {
                        state = 1;      // saw less than 2 block data words, start over
                        driveState.state = driveState.driveReadCheck;
                        reject(this.moveTapeTo(x-this.repositionWords, driveState));
                    } else {
                        state = 0;      // position into end of prior block, as usual
                        driveState.keyword = keyword;
                        resolve(this.moveTapeTo(x-this.repositionWords, driveState));
                    }
                    break;
                } // switch state
            }
        } while (state);
    }

    if (!this.ready || this.atBOT) {
        driveState.state = driveState.driveNotReady;
        return Promise.reject(driveState);
    } else {
        return new Promise(searchBackward);
    }
};

/**************************************/
B220MagTapeDrive.prototype.readNextBlock = function readNextBlock(driveState, record, controlEnabled, storeWord) {
    /* Reads one block on tape. "record" is true for MRR. "controlEnabled" is true
    if control blocks are to be recognized. "storeWord" is a call-back to store
    the next word into the Processor's memory. This routine is used for both MRD
    and MRR, as block lengths are determined by the tape control unit. Returns
    a Promise that resolves when the read completes */

    var readBlock = (resolve, reject) => {
        /* Reads the next block in the tape image */
        var controlBlock = false;       // true if control block detected
        var count = 0;                  // word counter within block
        var firstWord = false;          // flag for initial memory fetch
        var imgLength = this.imgLength; // physical end of tape index
        var lane = this.image[this.laneNr]; // image data for current lane
        var preface = 0;                // block length read from tape image
        var sign = 0;                   // sign digit of keyword
        var state = 1;                  // FSA state variable
        var w = 0;                      // current image word
        var x = this.imgIndex;          // lane image word index

        do {
            if (x >= imgLength) {
                state = 0;              // at EOT: just exit and leave the control hanging...
                driveState.state = driveState.driveAtEOT;
                this.moveTapeTo(x, driveState).then(this.boundSetEOT);
            } else {
                w = lane[x];
                switch (state) {
                case 1: // initial state: skip over flaw and intra-block words
                    if (w == this.markerGap) {
                        ++x;
                        state = 2;
                    } else {
                        ++x;
                    }
                    break;

                case 2: // skip over inter-block gap and magnetic EOT words
                    if (w == this.markerGap) {
                        ++x;
                    } else if (w == this.markerMagEOT) {
                        ++x;
                    } else if (w >= 0) {
                        state = 3;      // found the preface
                    } else {
                        state = 0;      // not a formatted tape
                        driveState.state = driveState.drivePrefaceCheck;
                        reject(this.moveTapeTo(x, driveState));
                    }
                    break;

                case 3: // read the preface and check for EOT block
                    ++x;
                    preface = w;
                    if (preface == 1) {
                        state = 6;      // detected end-of-tape block
                    } else if (preface < this.minBlockWords && preface > 1) {
                        state = 0;      // invalid preface on tape
                        driveState.state = driveState.drivePrefaceCheck;
                        reject(this.moveTapeTo(x, driveState));
                    } else {
                        state = 4;      // normal or control block
                    }
                    break;

                case 4: // read the keyword, detect control block, store the preface if necessary, store keyword
                    if (w < 0) {
                        state = 0;      // preface/block-length mismatch
                        driveState.state = driveState.driveReadCheck;
                        reject(this.moveTapeTo(x-1, driveState).then(this.boundReposition));
                    } else {
                        ++x;
                        if (controlEnabled) {
                            sign = (w - w%0x10000000000)/0x10000000000;
                            if (sign == 7) {
                                controlBlock = true;
                                // strip sign digit from keyword (not entirely sure this should be done)
                                w %= 0x10000000000;
                            }
                        }

                        if (record) {   // store the preface word (with keyword sign if a control block)
                            sign = ((sign*0x100 + (preface%100 - preface%10)/10)*0x10 + preface%10)*0x100000000;
                            if (storeWord(firstWord, sign) < 0) {
                                state = 10; // memory error storing preface word
                                driveState.state = driveState.driveMemoryError;
                            } else {
                                firstWord = false;
                            }
                        }

                        if (state == 4) {  // no error detected yet
                            if (controlBlock) {
                                --preface; // decrement block length to prevent storing the control word
                            }

                            if (storeWord(firstWord, w) < 0) {
                                state = 10; // memory error storing keyword from block
                                driveState.state = driveState.driveMemoryError;
                            } else {
                                firstWord = false;
                                ++count;
                                state = 5;
                            }
                        }
                    }
                    break;

                case 5: // read and store the remaining block words
                    if (count < preface) {
                        if (w < 0) {
                            state = 0;  // preface/block-length mismatch
                            driveState.state = driveState.driveReadCheck;
                            reject(this.moveTapeTo(x-1, driveState).then(this.boundReposition));
                        } else {
                            if (storeWord(firstWord, w) < 0) {
                                state = 10; // memory error storing data word from block
                                driveState.state = driveState.driveMemoryError;
                            } else {
                                firstWord = false;
                                ++x;
                                ++count;
                            }
                        }
                    } else if (controlBlock) {
                        if (w < 0) {
                            state = 0;  // preface/block-length mismatch
                            driveState.state = driveState.driveReadCheck;
                            reject(this.moveTapeTo(x-1, driveState).then(this.boundReposition));
                        } else {
                            driveState.state = driveState.driveHasControlWord;
                            driveState.controlWord = w;
                            ++x;
                            state = 7;      // deal with the control word after EOB
                        }
                    } else {
                        state = 7;          // check for proper EOB
                    }
                    break;

                case 6: // capture the control word for an end-of-tape block
                    if (w < 0) {
                        state = 0;      // block was shorter than preface indicated
                        driveState.state = driveState.driveReadCheck;
                        reject(this.moveTapeTo(x-1, driveState).then(this.boundReposition));
                    } else {
                        driveState.state = driveState.driveHasControlWord;
                        driveState.controlWord = w;
                        ++x;
                        state = 8;
                    }
                    break;

                case 7: // check for proper end-of-block
                    if (w == this.markerEOB) {
                        ++x;
                        state = 9;
                    } else {
                        state = 0;      // block was longer than preface indicated
                        driveState.state = driveState.driveReadCheck;
                        reject(this.moveTapeTo(x-1, driveState).then(this.boundReposition));
                    }
                    break;

                case 8: // step through remaining words in the block until normal EOB
                    if (w == this.markerEOB) {
                        ++x;
                        state = 9;
                    } else {
                        ++x;
                    }
                    break;

                case 9: // step through erase-gap words and finish normally
                    if (w == this.markerEOB) {
                        ++x;
                    } else {
                        state = 0;
                        resolve(this.moveTapeTo(x, driveState));
                    }
                    break;

                case 10: // step through remaining words in the block until EOB for error
                    if (w == this.markerEOB) {
                        ++x;
                        state = 11;
                    } else {
                        ++x;
                    }
                    break;

                case 11: // step through erase-gap words and finish with error
                    if (w == this.markerEOB) {
                        ++x;
                    } else {
                        state = 0;
                        reject(this.moveTapeTo(x, driveState));
                    }
                    break;
                } // switch state
            }
        } while (state);
    }

    if (!this.ready || this.atEOT) {
        driveState.state = driveState.driveNotReady;
        return Promise.reject(driveState);
    } else {
        return new Promise(readBlock);
    }
};

/**************************************/
B220MagTapeDrive.prototype.overwriteBlock = function overwriteBlock(driveState, record, words, fetchWord) {
    /* Overwrites one block on tape. "record" is true for MOR. "words" is the
    number of words to write in the block. "fetchWord" is a call-back to
    retrieve the next word from the Processor's memory. This routine is used
    for both MOW and MOR, as block lengths are determined by the tape
    control unit. Returns a Promise that resolves when the write completes */

    var writeBlock = (resolve, reject) => {
        /* Overwrites the next block in the tape image */
        var count = 0;                  // word counter within block
        var firstWord = !record;        // flag for initial memory fetch
        var imgLength = this.imgLength; // physical end of tape index
        var lane = this.image[this.laneNr]; // image data for current lane
        var state = 1;                  // FSA state variable
        var w = 0;                      // current image word
        var x = this.imgIndex;          // lane image word index

        do {
            if (x >= imgLength) {
                state = 0;              // at EOT: just exit and leave the control hanging...
                driveState.state = driveState.driveAtEOT;
                this.moveTapeTo(x, driveState).then(this.boundSetEOT);
            } else {
                w = lane[x];
                switch (state) {
                case 1: // initial state: skip over flaw and intra-block words
                    if (w == this.markerGap) {
                        ++x;
                        state = 2;
                    } else {
                        ++x;
                    }
                    break;

                case 2: // skip over inter-block gap and magnetic EOT words
                    if (w == this.markerGap) {
                        ++x;
                    } else if (w == this.markerMagEOT) {
                        ++x;
                    } else if (w >= 0) {
                        state = 3;      // found the preface
                    } else {
                        state = 0;      // not a formatted tape
                        driveState.state = driveState.drivePrefaceCheck;
                        reject(this.moveTapeTo(x, driveState));
                    }
                    break;

                case 3: // check the preface
                    ++x;
                    if (w < this.minBlockWords && w > 1) {
                        state = 0;      // invalid preface on tape
                        driveState.state = driveState.drivePrefaceCheck;
                        reject(this.moveTapeTo(x, driveState));
                    } else if (w == words) {
                        state = 4;      // preface match: overwrite the block
                    } else if (w == 1) {
                        state = 5;
                    } else {
                        state = 0;      // other preface mismatch
                        driveState.state = driveState.drivePrefaceMismatch;
                        reject(this.moveTapeTo(x, driveState).then(this.boundReposition));
                    }
                    break;

                case 4: // overwrite the block words
                    if (count < words) {
                        if (w < 0) {
                            state = 0;  // block was shorter than preface indicated
                            driveState.state = driveState.driveReadCheck;
                            reject(this.moveTapeTo(x-1, driveState).then(this.boundReposition));
                        } else {
                            w = fetchWord(firstWord);
                            if (w < 0) {
                                state = 8; // memory error: gobble rest of block
                                driveState.state = driveState.driveMemoryError;
                            } else {
                                firstWord = false;
                                lane[x] = w;
                                ++x;
                                ++count;
                            }
                        }
                    } else if (count < this.minBlockWords) {
                        if (w < 0) {
                            state = 0;  // block was shorter than preface indicated
                            driveState.state = driveState.driveReadCheck;
                            reject(this.moveTapeTo(x-1, driveState).then(this.boundReposition));
                        } else {
                            lane[x] = 0; // pad out an EOT block
                            ++x;
                            ++count;
                        }
                    } else if (w == this.markerEOB) {
                        state = 7;      // normal block termination
                    } else {
                        state = 0;      // block was longer than preface indicated
                        driveState.state = driveState.driveReadCheck;
                        reject(this.moveTapeTo(x-1, driveState).then(this.boundReposition));
                    }
                    break;

                case 5: // capture control word for EOT block
                    if (w < 0) {
                        state = 0;      // block was shorter than preface indicated
                        driveState.state = driveState.driveReadCheck;
                        reject(this.moveTapeTo(x-1, driveState).then(this.boundReposition));
                    } else {
                        driveState.state = driveState.driveHasControlWord;
                        driveState.controlWord = w;
                        ++x;
                        state = 6;      // gobble the rest of the block and finish normally
                    }
                    break;

                case 6: // step through remaining words in the block until normal EOB
                    if (w == this.markerEOB) {
                        ++x;
                        state = 7;
                    } else {
                        ++x;
                    }
                    break;

                case 7: // step through erase-gap words and finish normally
                    if (w == this.markerEOB) {
                        ++x;
                    } else {
                        state = 0;
                        resolve(this.moveTapeTo(x, driveState));
                    }
                    break;

                case 8: // step through remaining words in the block until EOB for error
                    if (w == this.markerEOB) {
                        ++x;
                        state = 9;
                    } else {
                        ++x;
                    }
                    break;

                case 9: // step through erase-gap words and finish with error
                    if (w == this.markerEOB) {
                        ++x;
                    } else {
                        state = 0;
                        reject(this.moveTapeTo(x, driveState));
                    }
                    break;
                } // switch state
            }
        } while (state);
    }

    if (!this.ready || this.atEOT || this.notWrite) {
        driveState.state = driveState.driveNotReady;
        return Promise.reject(driveState);
    } else {
        this.imgWritten = true;         // mark the tape image as modified
        return new Promise(writeBlock);
    }
};

/**************************************/
B220MagTapeDrive.prototype.initialWriteFinalize = function initialWriteFinalize(driveState) {
    /* Write a longer inter-block gap so that MPE will work at magnetic
    end-of-tape and check for end-of-tape prior to terminating the I/O */

    return new Promise((resolve, reject) => {
        var count = this.startOfBlockWords*2; // number of gap words
        var done = false;               // loop control
        var imgLength = this.imgLength; // physical end of tape index
        var lane = this.image[this.laneNr]; // image data for current lane
        var x = this.imgIndex;          // lane image word index

        do {
            if (x >= imgLength) {
                done = true;            // at end-of-tape
                resolve(this.moveTapeTo(x, driveState).then(this.boundSetEOT));
            } else if (count > 0) {
                --count;                // write extra inter-block gap word
                lane[x] = this.markerGap;
                ++x;
            } else if (lane[x] == this.markerMagEOT) {
                ++x;                    // space over magnetic EOT words
            } else {
                done = true;            // finish write
                resolve(this.moveTapeTo(x, driveState));
            }
        } while(!done);
    });
};

/**************************************/
B220MagTapeDrive.prototype.initialWriteBlock = function initialWriteBlock(driveState, record, words, fetchWord) {
    /* Initial-writes one block on edited (blank) tape. "record" is true for MIR.
    "words" is the number of words to write in the block. "fetchWord" is a call-
    back to retrieve the next word from the Processor's memory. This routine is
    used for both MIW and MIR, as block lengths are determined by the tape
    control unit. Returns a Promise that resolves when the write completes */

    var writeBlock = (resolve, reject) => {
        /* Initial-writes the next block in the tape image */
        var count = 0;                  // word counter within block
        var firstWord = !record;        // flag for initial memory fetch
        var gapCount = 0;               // count of consecutive inter-block gap words
        var imgLength = this.imgLength; // physical end of tape index
        var lane = this.image[this.laneNr]; // image data for current lane
        var state = 1;                  // FSA state variable
        var w = 0;                      // memory word value
        var x = this.imgIndex;          // lane image word index

        do {
            if (x >= imgLength) {
                state = 0;              // at EOT: just exit and leave the control hanging...
                driveState.state = driveState.driveAtEOT;
                this.moveTapeTo(x, driveState).then(this.boundSetEOT);
            } else {
                switch (state) {
                case 1: // initial state: skip over flaw and intra-block words
                    if (lane[x] == this.markerGap) {
                        state = 2;
                    } else {
                        ++x;
                    }
                    break;

                case 2: // count 3 consecutive inter-block gap words
                    if (lane[x] == this.markerGap) {
                        ++gapCount;
                        if (gapCount < this.startOfBlockWords) {
                            ++x;
                        } else {
                            state = 3;
                        }
                    } else if (lane[x] == this.markerMagEOT) {
                        ++x;
                    } else {
                        state = 0;      // not an edited tape
                        driveState.state = driveState.driveNotEditedTape;
                        reject(this.moveTapeTo(x, driveState));
                    }
                    break;

                case 3: // write the preface
                    lane[x] = words;
                    ++x;
                    state = 4;
                    break;

                case 4: // write the block words
                    if (count < words) {
                        w = fetchWord(firstWord);
                        if (w < 0) {
                            state = 0;  // memory fetch failed
                            driveState.state = driveState.driveMemoryError;
                            state = 5;
                        } else {
                            firstWord = false;
                            lane[x] = w;
                            ++x;
                            ++count;
                        }
                    } else {
                        state = 6;
                    }
                    break;

                case 5: // pad out the block after a memory error
                    if (count < words) {
                        lane[x] = 0;
                        ++x;
                        ++count;
                    } else {
                        state = 6;
                    }
                    break;

                case 6: // pad out to the minimum block length (e.g., for an EOT block)
                    if (count < this.minBlockWords) {
                        lane[x] = 0;
                        ++x;
                        ++count;
                    } else {
                        count = 0;
                        state = 7;
                    }
                    break;

                case 7: // write the erase gap
                    if (count < this.endOfBlockWords) {
                        lane[x] = this.markerEOB;
                        ++x;
                        ++count;
                    } else {
                        state = 0;      // finished with the block
                        this.imgTopWordNr = x;
                        resolve(this.moveTapeTo(x, driveState));
                    }
                    break;
                } // switch state
            }
        } while (state);
    };

    if (!this.ready || this.atEOT || this.notWrite) {
        driveState.state = driveState.driveNotReady;
        return Promise.reject(driveState);
    } else {
        this.imgWritten = true;         // mark the tape image as modified
        return new Promise(writeBlock);
    }
};

/**************************************/
B220MagTapeDrive.prototype.spaceForwardBlock = function spaceForwardBlock(driveState) {
    /* Positions tape one block in a forward direction. Leaves the block
    positioned at the preface word, ready to space the next block or reposition
    into the prior block at the end of the operation. Returns a Promise that
    resolves after the block is spaced */

    var spaceBlock = (resolve, reject) => {
        /* Spaces forward over the next block. Blocks are counted as their
        preface words are passed. This routine does this by detecting the
        transition between the preface and its immediately preceding gap word */
        var imgLength = this.imgLength;     // physical end of tape index
        var lane = this.image[this.laneNr]; // image data for current lane
        var state = 1;                      // FSA state variable
        var w = 0;                          // current image word
        var x = this.imgIndex;              // lane image word index

        do {
            if (x >= imgLength) {
                state = 0;                      // at EOT: just exit and leave the control hanging...
                driveState.state = driveState.driveAtEOT;
                this.moveTapeTo(x, driveState).then(this.boundSetEOT);
            } else {
                w = lane[x];
                switch (state) {
                case 1: // initial state: skip over flaw and intra-block words
                    if (w == this.markerGap) {
                        ++x;
                        state = 2;
                    } else {
                        ++x;
                    }
                    break;

                case 2: // skip inter-block gap words
                    if (w == this.markerGap) {
                        ++x;
                    } else {
                        state = 3;
                    }
                    break;

                case 3: // found preface: search for end of block (next erase-gap word)
                    if (w == this.markerEOB) {
                        ++x;
                        state = 4;
                    } else {
                        ++x;
                    }
                    break;

                case 4: // step through erase-gap words and finish
                    if (w == this.markerEOB) {
                        ++x;
                    } else {
                        state = 0;
                        resolve(this.moveTapeTo(x, driveState));
                    }
                    break;
                } // switch state
            }
        } while (state);

    }

    if (!this.ready || this.atEOT) {
        driveState.state = driveState.driveNotReady;
        return Promise.reject(driveState);
    } else {
        return new Promise(spaceBlock);
    }
};

/**************************************/
B220MagTapeDrive.prototype.spaceBackwardBlock = function spaceBackwardBlock(driveState) {
    /* Positions tape one block in a backward direction. Leaves the block
    positioned five words into the end of the prior block, as for a normal
    reposition after a forward operation. Returns a Promise that resolves
    after the block is spaced */

    var spaceBlock = (resolve, reject) => {
        /* Spaces backward over the current or prior block. Blocks are counted
        as their preface words are passed. This routine does that by detecting
        the transition between the preface and its immediately preceding gap word */
        var lane = this.image[this.laneNr]; // image data for current lane
        var state = 1;                      // FSA state variable
        var w = 0;                          // current image word
        var x = this.imgIndex-1;            // lane image word index (start with prior word)

        do {
            if (x <= 0) {
                state = 0;                      // at BOT: just exit and leave the control hanging...
                driveState.state = driveState.driveAtBOT;
                this.moveTapeTo(x, driveState).then(this.boundSetBOT);
            } else {
                w = lane[x];
                switch (state) {
                case 1: // initial state: skip over flaw and magnetic EOT words
                    if (w == this.markerGap) {
                        --x;
                        state = 2;
                    } else if (w == this.markerFlaw) {
                        --x;
                    } else if (w == this.markerMagEOT) {
                        --x;
                    } else {
                        state = 3;
                    }
                    break;

                case 2: // skip initial inter-block gap words
                    if (w == this.markerGap) {
                        --x;
                    } else {
                        state = 3;
                    }
                    break;

                case 3: // search for start of block (first prior inter-block gap word)
                    if (w == this.markerGap) {
                        state = 4;
                    } else {
                        --x;
                    }
                    break;

                case 4: // skip this block's inter-block gap words
                    if (w == this.markerGap) {
                        --x;
                    } else {
                        state = 5;
                    }
                    break;

                case 5: // skip the prior block's erase-gap words
                    if (w == this.markerEOB) {
                        --x;
                    } else {            // position into end of prior block, as usual
                        state = 0;
                        resolve(this.moveTapeTo(x-this.repositionWords, driveState));
                    }
                    break;
                } // switch state
            }
        } while (state);
    }

    if (!this.ready || this.atBOT) {
        driveState.state = driveState.driveNotReady;
        return Promise.reject(driveState);
    } else {
        return new Promise(spaceBlock);
    }
};

/**************************************/
B220MagTapeDrive.prototype.spaceEOIBlock = function spaceEOIBlock(driveState) {
    /* Spaces forward one block on tape, detecting end-of-information if encountered
    (i.e., gap longer and inter-block gap. Returns a Promise that resolves
    after the block is spaced or EOI is encountered */

    var spaceBlock = (resolve, reject) => {
        /* Spaces over the next block, unless a long gap or physical EOT is
        encountered */
        var gapCount = 0;                   // number of consecutive erase-gap words
        var imgLength = this.imgLength;     // physical end of tape index
        var lane = this.image[this.laneNr]; // image data for current lane
        var state = 1;                      // FSA state variable
        var w = 0;                          // current image word
        var x = this.imgIndex;              // lane image word index

        do {
            if (x >= imgLength) {
                state = 0;                  // at EOT: just exit and leave the control hanging...
                driveState.state = driveState.driveAtEOT;
                this.moveTapeTo(x, driveState).then(this.boundSetEOT);
            } else {
                w = lane[x];
                switch (state) {
                case 1: // initial state: skip over flaw words
                    if (w == this.markerGap) {
                        state = 2;
                    } else if (w == this.markerFlaw) {
                        ++x;
                    } else {
                        state = 3;
                    }
                    break;

                case 2: // count inter-block gap words
                    if (w != this.markerGap) {
                        state = 3;
                    } else if (gapCount > this.startOfBlockWords) {
                        state = 0;
                        driveState.state = driveState.driveAtEOI;
                        resolve(this.moveTapeTo(x, driveState));
                    } else {
                        ++x;
                        ++gapCount;
                    }
                    break;

                case 3: // search for end of block (next erase-gap word)
                    if (w == this.markerEOB) {
                        ++x;
                        state = 4;
                    } else {
                        ++x;
                    }
                    break;

                case 4: // step through erase-gap words and finish
                    if (w == this.markerEOB) {
                        ++x;
                    } else {
                        state = 0;
                        resolve(this.moveTapeTo(x, driveState));
                    }
                    break;
                } // switch state
            }
        } while (state);
    };

    if (!this.ready || this.atEOT) {
        driveState.state = driveState.driveNotReady;
        return Promise.reject(driveState);
    } else {
        return new Promise(spaceBlock);
    }
};

/**************************************/
B220MagTapeDrive.prototype.laneSelect = function laneSelect(driveState, laneNr) {
    /* Selects the tape lane on the unit. If the drive is busy or not ready,
    returns true */

    if (this.busy) {
        driveState.state = driveState.driveBusy;
        return Promise.reject(driveState);
    } else if (!this.ready || this.rewindLock || this.atEOT) {
        driveState.state = driveState.driveNotReady;
        return Promise.reject(driveState);
    } else {
        this.busy = true;
        this.designatedLamp.set(1);
        return this.setLane(laneNr, driveState);
    }
};

/**************************************/
B220MagTapeDrive.prototype.rewind = function rewind(driveState, laneNr, lockout) {
    /* Initiates a rewind operation on the unit. Makes the drive not-ready,
    delays for an appropriate amount of time depending on how far up-tape we
    are, then readies the unit again. Returns a Promise that resolves once the
    rewind completes */

    if (this.busy) {
        driveState.state = driveState.driveBusy;
        return Promise.reject(driveState);
    } else if (!this.ready || this.rewindLock) {
        driveState.state = driveState.driveNotReady;
        return Promise.reject(driveState);
    } else {
        this.designatedLamp.set(1);
        return this.tapeRewind(laneNr, lockout);
    }
};

/**************************************/
B220MagTapeDrive.prototype.shutDown = function shutDown() {
    /* Shuts down the device */

    if (this.timer) {
        clearCallback(this.timer);
    }
    this.window.removeEventListener("beforeunload", B220MagTapeDrive.prototype.beforeUnload, false);
    this.window.close();
    if (this.loadWindow && !this.loadWindow.closed) {
        this.loadWindow.close();
    }
};
