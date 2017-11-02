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
* format. Each line in the file represents one block for one lane. Each field
* on the line represents one word for the tape image. The first field on the
* line represents the lane number -- only its low-order bit is significant (0/1).
* The second field is the preface word indicating the length of the data. A
* block length of 100 is represented as either 0 or 100. Values greater than 100
* or less than zero will be treated as 100.
*
* Note that with this representation, it is possible that the count in the
* preface may not match the actual number of words on the rest of the line.
* While this might be useful at some point to allow construction of invalid
* tape blocks that generate Tape Preface Failure (TPF) halts, at present the
* block is stored in the internal tape image with exactly the number of words
* specified by the preface. The remaining words on the line will be truncated
* or padded with zero words as necessary in the internal image to achieve this
* block length.
*
* Also note that the arrangement of blocks with respect to their lane is
* arbitrary. Blocks for a lane can be arranged on the external image separately
* or intermingled with the blocks for the other lane. When exporting a tape
* image that has been modified, the drive will always dump all of lane 0 and
* then all of lane 1. To save space in the external image, trailing words of
* zeroes will be trimmed from each block. The lane number and preface word will
* written, however.
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

    this.doc = null;
    this.window = window.open("../webUI/B220MagTapeDrive.html", mnemonic,
            "location=no,scrollbars=no,resizable,width=384,height=184,left=0,top=" + y);
    this.window.addEventListener("load",
            B220Util.bindMethod(this, B220MagTapeDrive.prototype.tapeDriveOnload), false);
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
B220MagTapeDrive.prototype.repositionWords = 2;
                                        // number of words to reposition back into the block after a turnaround
B220MagTapeDrive.prototype.startTime = 3;
                                        // tape start time [ms]
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
B220MagTapeDrive.prototype.nil = function nil() {
    /* An empty function that just returns */

    return;
};

/**************************************/
B220MagTapeDrive.prototype.releaseUnit = function releaseUnit(releaseControl, alarm) {
    /* Releases the busy status of the unit. Typically used as a timed call-
    back to simulate the amount of time the unit is busy with an I/O */

    this.busy = false;
    this.designatedLamp.set(0);
    if (releaseControl) {
        releaseControl(alarm);
    }
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
B220MagTapeDrive.prototype.moveTape = function moveTape(inches, delay, successor) {
    /* Delays the I/O during tape motion, during which it animates the reel image
    icon. At the completion of the "delay" time in milliseconds, "successor" is
    called with no parameters. */
    var delayLeft = Math.abs(delay);    // milliseconds left to delay
    var direction = (inches < 0 ? -1 : 1);
    var inchesLeft = inches;            // inches left to move tape
    var lastStamp = performance.now();  // last timestamp for spinDelay

    function spinFinish() {
        this.timer = 0;
        if (inchesLeft != 0) {
            this.spinReel(inchesLeft);
        }
        successor.call(this);
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

        if ((delayLeft -= interval) > this.spinUpdateInterval) {
            lastStamp = stamp;
            this.timer = setCallback(this.mnemonic, this, this.spinUpdateInterval, spinDelay);
        } else {
            this.timer = setCallback(this.mnemonic, this, delayLeft, spinFinish);
        }
        motion = inches*interval/delay;
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

    spinDelay.call(this);
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
B220MagTapeDrive.prototype.setTapeReady = function setTapeReady(makeReady) {
    /* Controls the ready-state of the tape drive */
    var enabled = (this.tapeState != this.tapeUnloaded) && !this.rewindLock &&
                  (this.tapeState != this.tapeRewinding && this.powerOn);

    this.ready = this.remote & makeReady && enabled;
    this.notReadyLamp.set(this.ready ? 0 : 1);
    if (!this.ready) {
        this.busy = false;              // forced reset
        this.designatedLamp.set(0);
    }

    if (enabled) {
        if (this.remote) {
            this.tapeState = this.tapeRemote;
        } else {
            this.busy = false;          // forced reset
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
        B220Util.addClass(this.$$("MTUnloadedLight"), "annunciatorLit");
        if (this.timer) {
            clearCallback(this.timer);
            this.timer = 0;
        }
    }
};

/**************************************/
B220MagTapeDrive.prototype.findBlockStart = function findBlockStart() {
    /* Searches forward in the tape image on the currently-selected lane for the
    start of a block or magnetic end-of-tape markers, or physical end-of-tape,
    whichever occurs first. If an inter-block (blank) gap word is found, skips
    over all of them and reads the preface word. Returns the preface word, or
    the magnetic EOT marker (-3) word, or if physical EOT is encountered, an
    inter-block gap (-1) word */
    var imgLength = this.imgLength;     // physical end of tape index
    var lane = this.image[this.laneNr]; // image data for current lane
    var result = this.markerGap;        // function result
    var state = 1;                      // FSA state variable
    var w;                              // current image word
    var x = this.imgIndex;              // lane image word index

    while (x < imgLength) {
        w = lane[x++];
        switch (state) {
        case 1: // search for inter-block gap word
            if (w == this.markerGap) {
                state = 2;
            } else if (w == this.markerMagEOT) {
                result = w;             // return the EOT word
                this.imgIndex = x-1;    // point to EOT word
                x = imgLength;          // kill the loop
            }
            break;

        case 2: // search for preface word
            if (w >= 0) {
                result = w;             // found preface, return it
                this.imgIndex = x;      // point to first data word in block
                x = imgLength;          // kill the loop
            } else if (w != this.markerGap) {
                result = w;             // return whatever marker word was found
                this.imgIndex = x-1;    // point to the word found
                x = imgLength;          // kill the loop
            }
            break;

        default:
            x = imgLength;              // kill the loop
            throw new Error("Invalid state: B220MagTapeDrive.findBlockStart, " + state);
            break;
        } // switch state
    } // while x

    return result;
};

/**************************************/
B220MagTapeDrive.prototype.writeBlockStart = function writeBlockStart(length) {
    /* Writes the start-of-block words to the tape image buffer in the current
    lane number and at the current offset of this.imgIndex: 3 gap words + the
    preface word with the binary block length */
    var x;

    for (x=0; x<this.startOfBlockWords-1; ++x) {
        this.image[this.laneNr][this.imgIndex+x] = this.markerGap;
    }

    this.image[this.laneNr][this.imgIndex+x] = length;  // preface word
    this.imgIndex += this.startOfBlockWords;
};

/**************************************/
B220MagTapeDrive.prototype.writeBlockEnd = function writeBlockEnd() {
    /* Writes the start-of-block words to the tape image buffer at the current
    value of this.imgIndex: 3 gap words + the preface word with the binary block
    length */
    var x;

    for (x=0; x<this.endOfBlockWords; ++x) {
        this.image[this.laneNr][this.imgIndex+x] = this.markerEOB;
    }

    this.imgIndex += this.endOfBlockWords;
};

/**************************************/
B220MagTapeDrive.prototype.writeEndOfTapeBlock = function writeEndOfTapeBlock(controlWord) {
    /* Writes an end-of-tape block containing the designated controlWord */
    var x;

    this.writeBlockStart(1);
    this.image[this.laneNr][this.imgIndex++] = controlWord;
    for (x=0; x<9; ++x) {
        this.image[this.laneNr][this.imgIndex+x] = 0;
    }

    this.imgIndex += 9;
    this.writeBlockEnd();
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
    }

    function finishLoad() {
        /* Finishes the tape loading process and closes the loader window */
        var x;

        mt.laneNr = 0;
        mt.notWrite = !$$$("MTLoadWriteEnableCheck").checked;
        mt.notWriteLamp.set(mt.notWrite ? 1 : 0);
        mt.reelBar.max = mt.maxTapeInches;
        mt.reelBar.value = mt.maxTapeInches;
        mt.setAtBOT(true);
        mt.setAtEOT(false);
        mt.tapeState = mt.tapeLocal;    // setTapeReady() requires it not be unloaded
        mt.setTapeReady(true);
        mt.reelIcon.style.visibility = "visible";
        B220Util.removeClass(mt.$$("MTUnloadedLight"), "annunciatorLit");
    }

    function editedLoader() {
        /* Loads an edited (blank) tape image into both lanes of the drive. If
        a block length was chosen on the tape-load panel, initializes the image
        with blocks of that size, followed by an end-of-tape block with
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
                    mt.writeBlockStart(blockLen);
                    for (x=0; x<blockLen; ++x) {
                        lane[mt.imgIndex+x] = 0;
                    }

                    mt.imgIndex += blockLen;
                    mt.writeBlockEnd();
                } // while

                mt.writeEndOfTapeBlock(0x00000001); // aaaa=0000, bbbb=0001

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
        var blockLen;                   // length of current tape block
        var chunk;                      // ANSI text of current chunk
        var chunkLength;                // length of current ASCII chunk
        var buf = ev.target.result;     // ANSI tape image buffer
        var bufLength = buf.length;     // length of ANSI tape image buffer
        var eolRex = /([^\n\r\f]*)((:?\r[\n\f]?)|\n|\f)?/g;
        var index = 0;                  // char index into tape image buffer for next chunk
        var lane;                       // current tape lane image
        var lx = [0,0];                 // word indexes for each lane
        var match;                      // result of eolRex.exec()
        var preface;                    // preface word: block length in words
        var tx;                         // char index into ANSI chunk text
        var wx;                         // word index within current block

        function parseWord() {
            /* Parses the next word from the chunk text and returns its value as BCD */
            var cx;                     // offset to next comma
            var text;                   // text of parsed word
            var v;                      // parsed decimal value
            var w = 0;                  // result BCD word

            if (tx < chunkLength) {
                cx = chunk.indexOf(",", tx);
                if (cx < 0) {
                    cx = chunkLength;
                }
                text = chunk.substring(tx, cx).trim();
                if (text.length > 0) {
                    v = parseInt(text, 16);     // parse as hex (BCD)
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
                    tx = wx = 0;
                    mt.laneNr = parseWord()%2;          // get the lane number
                    preface = parseWord();              // get the preface word as hex BCD
                    mt.imgIndex = lx[mt.laneNr];        // restore current offset for this lane
                    if (preface > 0x100) {
                        blockLen = 100;                 // limit blocks to 100 words
                    } else if (preface > 0) {
                        blockLen = B220Processor.bcdBinary(preface);
                    } else {                            // if the block length is 0, make it 100
                        blockLen = 100;
                    }

                    mt.writeBlockStart(blockLen);
                    lane = mt.image[mt.laneNr];
                    while (tx < chunkLength && wx < blockLen) {
                        lane[mt.imgIndex+wx] = parseWord();
                        ++wx;
                    } // while

                    if (blockLen == 1) {
                        blockLen = 10;                  // pad out end-of-tape blocks to 10 words
                    }

                    while (wx < blockLen) {
                        lane[mt.imgIndex+wx] = 0;
                        ++wx;
                    } // while

                    mt.imgIndex += blockLen;
                    mt.writeBlockEnd();
                    lx[mt.laneNr] = mt.imgIndex;        // save current offset for this lane
                }
            }
        } while (index < bufLength);

        // Write a gap at the end of both lanes so that MPE can sense end-of-info.
        for (mt.laneNr=0; mt.laneNr<2; ++mt.laneNr) {
            lane = mt.image[mt.laneNr];
            mt.imgIndex = lx[mt.laneNr];
            for (x=0; x<mt.startOfBlockWords*2; ++x) {
                lane[mt.imgIndex+x] = mt.markerGap;
            }
            lx[mt.laneNr] = mt.imgIndex + mt.startOfBlockWords*2;
        } // for tx (lane number)

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

        fileSelect = $$$("MTLoadFileSelector");
        fileSelect.addEventListener("change", fileSelector_onChange, false);

        $$$("MTLoadFormatSelect").addEventListener("change", selectFormat_onChange, false);
        $$$("MTLoadOKBtn").addEventListener("click", tapeLoadOK, false);
        $$$("MTLoadCancelBtn").addEventListener("click", tapeLoadCancel, false);

        win.focus();
        win.resizeBy(de.scrollWidth - win.innerWidth,
                     de.scrollHeight - win.innerHeight);
    }

    // Outer block of loadTape
    if (this.loadWindow && !this.loadWindow.closed) {
        this.loadWindow.close();
    }
    this.loadWindow = win;
    win.addEventListener("load", tapeLoadOnload, false);
    win.addEventListener("unload", function tapeLoadUnload(ev) {
        this.loadWindow = null;
    }, false);
};

/**************************************/
B220MagTapeDrive.prototype.unloadTape = function unloadTape() {
    /* Reformats the tape image data as ASCII text and displays it in a new
    window so the user can save or copy/paste it elsewhere */
    var doc = null;                     // loader window.document
    var mt = this;                      // tape drive object
    var win = this.window.open("./B220FramePaper.html", this.mnemonic + "-Unload",
            "location=no,scrollbars=yes,resizable,width=800,height=600");

    function unloadDriver() {
        /* Converts the tape image to ASCII once the window has displayed the
        waiting message */
        var buf;                        // ANSI tape image buffer
        var imgLength = mt.imgLength;   // active words in tape image
        var imgTop = mt.imgTopWordNr;   // tape image last block number
        var lane;                       // lane image buffer
        var lx;                         // lane index
        var nzw;                        // number of consecutive zero words
        var state;                      // lane processing state variable
        var tape;                       // <pre> element to receive tape data
        var w;                          // current image word
        var wx;                         // word index within block
        var x = 0;                      // image data index

        doc = win.document;
        doc.title = "retro-220 " + mt.mnemonic + " Unload Tape";
        tape = doc.getElementById("Paper");
        while (tape.firstChild) {               // delete any existing <pre> content
            tape.removeChild(tape.firstChild);
        }

        for (lx=0; lx<2; ++lx) {
            mt.laneNr = lx;
            lane = mt.image[lx];
            state = 1;
            x = 0;
            while (x < imgLength) {
                switch (state) {
                case 1: // Search for start of block
                    nzw = 0;
                    mt.imgIndex = x;
                    w = mt.findBlockStart();
                    if (w < 0) {        // done with this lane
                        x = imgLength;  // kill the loop
                    } else {            // format the preface word
                        buf = lx.toString(10) + "," + w.toString(10);
                        x = mt.imgIndex;
                        state = 2;
                    }
                    break;
                case 2: // Record the block data words
                    w = lane[x++];
                    if (w == 0) {
                        ++nzw;          // suppress trailing zero words
                    } else if (w >= 0) {
                        while (nzw > 0) {
                            --nzw;      // restore non-trailing zero words
                            buf += ",0";
                        }
                        buf += "," + w.toString(16);
                    } else {
                        tape.appendChild(doc.createTextNode(buf + "\n"));
                        state = 1;      // reset for next block
                    }
                    break;
                default:
                    x = imgLength;      // kill the loop
                    throw new Error("Invalid state: B220MagTapeDrive.unloadTape, " + state);
                    break;
                } // switch state
            } // while not at end of lane
        } // for lx

        mt.setTapeUnloaded();
    }

    function unloadSetup() {
        /* Loads a status message into the "paper" rendering area, then calls
        unloadDriver after a short wait to allow the message to appear */

        win.document.getElementById("Paper").appendChild(
                win.document.createTextNode("Rendering tape image... please wait..."));
        setTimeout(unloadDriver, 50);
    }

    // Outer block of unloadTape
    win.moveTo((screen.availWidth-win.outerWidth)/2, (screen.availHeight-win.outerHeight)/2);
    win.focus();
    win.addEventListener("load", unloadSetup, false);
};

/**************************************/
B220MagTapeDrive.prototype.tapeRewind = function tapeRewind(laneNr, lockout) {
    /* Rewinds the tape. Makes the drive not-ready and delays for an appropriate
    amount of time depending on how far up-tape we are. Readies the unit again
    when the rewind is complete unless lockout is truthy */
    var lastStamp;

    function rewindFinish() {
        this.timer = 0;
        this.tapeState = this.tapeLocal;
        B220Util.removeClass(this.$$("MTRewindingLight"), "annunciatorLit");
        this.laneNr = laneNr%2;
        this.rewindLock = (lockout ? true : false);
        this.rwlLamp.set(this.rewindLock ? 1 : 0);
        this.setTapeReady(!this.rewindLock);
        this.releaseUnit(null, false);
        if (this.ready) {
            this.tcu.tapeUnitFinished();
        }
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
};

/**************************************/
B220MagTapeDrive.prototype.tapeReposition = function tapeReposition(successor) {
    /* Reverses tape direction after a forward tape operation and repositions
    the head two words from the end of the block just passed, giving room for
    startup of the next forward operation. At completion, calls the successor
    function, passing false.

    A real 220 drive repositioned tape about 60 digits (five words) from the end
    of the data portion of the block, but that was to allow for tape acceleration
    of about 3ms, at which point it took about 2ms (50 digits, or just over four
    words) to reach the end of the erase gap and start of the inter-block gap
    for the next block. this.repositionWords is sized to approximate that 2ms
    delay */
    var done = false;                   // completion flag
    var lane = this.image[this.laneNr]; // image data for current lane
    var state = 1;                      // FSA state variable
    var x = this.imgIndex-1;            // lane image word index

    do {
        if (x <= 0) {
            done = true;
        } else {
            switch (state) {
            case 1: // initial state: skip backwards until erase-gap
                if (lane[x] == this.markerEOB) {
                    state = 2;
                } else {
                    --x;
                }
                break;
            case 2: // skip over erase-gap words
                if (lane[x] == this.markerEOB) {
                    --x;
                } else {
                    done = true;
                }
                break;
            } // switch state
        }
    } while (!done);

    x = this.imgIndex - x + this.repositionWords;       // words to reposition
    this.imgIndex -= x;
    this.moveTape(-x*this.inchesPerWord, this.turnaroundTime, successor);
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
        this.tapeRewind(this.laneNr, this.rewindLock, null);
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
            B220Util.bindMethod(this, B220MagTapeDrive.prototype.LoadBtn_onclick), false);
    this.$$("UnloadBtn").addEventListener("click",
            B220Util.bindMethod(this, B220MagTapeDrive.prototype.UnloadBtn_onclick), false);
    this.$$("RewindBtn").addEventListener("click",
            B220Util.bindMethod(this, B220MagTapeDrive.prototype.RewindBtn_onclick), false);
    this.unitDesignateList.addEventListener("change",
            B220Util.bindMethod(this, B220MagTapeDrive.prototype.UnitDesignate_onchange), false);
    this.$$("RWLRBtn").addEventListener("click",
            B220Util.bindMethod(this, B220MagTapeDrive.prototype.RWLRBtn_onclick), false);
    this.$$("WriteBtn").addEventListener("click",
            B220Util.bindMethod(this, B220MagTapeDrive.prototype.WriteBtn_onclick), false);
    this.$$("NotWriteBtn").addEventListener("click",
            B220Util.bindMethod(this, B220MagTapeDrive.prototype.WriteBtn_onclick), false);
    this.$$("TransportOnBtn").addEventListener("click",
            B220Util.bindMethod(this, B220MagTapeDrive.prototype.TransportOnBtn_onclick), false);
    this.$$("TransportStandbyBtn").addEventListener("click",
            B220Util.bindMethod(this, B220MagTapeDrive.prototype.TransportOnBtn_onclick), false);
};

/**************************************/
B220MagTapeDrive.prototype.searchBlock = function searchBlock(blockReady, releaseControl, laneNr) {
    /* Searches blocks on tape. "blockReady" is a function to be called after a
    block is searched. "releaseControl" is a function to call after the control
    signals completion (see release). "laneNr" is the lane on the tape to search.
    This routine is used for MTS and MFS */
    var imgLength = this.imgLength;     // physical end of tape index
    var keyWord = 0;                    // keyWord read from block
    var lane;                           // image data for current lane
    var result = false;
    var startDelay = this.startTime;    // delay for drive startup and lane change
    var that = this;

    function release() {
        /* Releases the unit and control */

        that.releaseUnit(releaseControl, false);
    }

    function finish() {
        /* Wraps up the positioning and delays before releasing the unit and control */
        var delay = 16 - that.startTime;

        setCallback(that.mnemonic, that, delay, release);
    }

    function turnaround() {
        /* Repositions the tape after the last block is written */

        that.tapeReposition(finish);
    }

    function signalControl() {
        /* Returns to the tape control after encountering an end-of-tape block,
        after the tape has been repositioned to read the EOT block */

        blockReady(false, true, keyWord, null, null, turnaround);
    }

    function repositionAndSignal() {
        /* Repositions the tape image so that an end-of-tape block can be read
        by the next operation. Then terminates the I/O */

        that.tapeReposition(signalControl);
    }

    function finalizeBlockForward() {
        /* Returns the keyWord to the tape control after searching one block in
        a forward direction */

        blockReady(false, false, keyWord, searchBlockForward, searchBlockBackward, turnaround);
    }

    function abort() {
        /* Aborts the I/O due to some error */

        blockReady(true, false, 0, null, null, release);
    }

    function setEOT() {
        /* Sets EOT status after positioning to end-of-tape. Does not release
        the control unit */

        that.setAtEOT(true);
        that.releaseUnit(null, false);
    }

    function advance (index, successor) {
        /* Advances the tape after a block is passed, then calls the successor */
        var len = index - that.imgIndex;    // number of words passed
        var delay = len*that.millisPerWord; // amount of tape spin time

        that.imgIndex = index;
        that.moveTape(len*that.inchesPerWord, delay, successor);
    }

    function searchBlockForward() {
        /* Reads the start of the next block in the tape image in a forward
        direction to obtain its keyword */
        var count = 0;                  // word counter
        var done = false;               // completion flag
        var state = 1;                  // FSA state variable
        var words = 0;                  // number of words from preface
        var w;                          // current image word
        var x = that.imgIndex;          // lane image word index

        if (!that.ready) {
            done = true;                // drive went non-ready
            advance.call(that, x, abort);
        } else {
            do {
                if (x >= imgLength) {
                    done = true;        // at EOT: just exit and leave everybody hanging...
                    that.busy = false;
                    advance.call(that, x, setEOT);
                } else {
                    w = lane[x];

                    switch (state) {
                    case 1: // initial state: skip over flaw and intra-block words
                        if (w == that.markerGap) {
                            state = 2;
                        } else {
                            ++x;
                        }
                        break;

                    case 2: // skip over inter-block gap and magnetic EOT words
                        if (w == that.markerGap) {
                            ++x;
                        } else if (w == that.markerEOT) {
                            ++x;
                        } else if (w >= 0) {
                            state = 3;          // found the preface
                        } else {
                            state = 1;          // ignore this block
                        }
                        break;

                    case 3: // read the preface
                        ++x;
                        words = w;
                        if (words < that.minBlockWords && words > 1) {
                            done = true;        // preface check: invalid block size
                            advance.call(that, x, abort);
                        } else {
                            state = 4;          // advance to the keyWord
                        }
                        break;

                    case 4: // read the keyword
                        ++x;
                        if (w < 0) {            // block was shorter than preface indicated,
                            state = 1;          // so ignore it and look for next block
                        } else {
                            done = true;
                            keyWord = w;
                            if (words == 1) {   // signal end-of-tape block
                                advance.call(that, x, repositionAndSignal);
                            } else {            // return keyWord to control
                                advance.call(that, x, finalizeBlockForward);
                            }
                        }
                        break;
                    } // switch state
                }
            } while (!done);
        }
    }

    function firstBlock() {
        /* Called after the startTime delay to signal the control unit we are
        ready for the first block of data */

        blockReady(false, false, 0, searchBlockForward, searchBlockBackward, release);
    }

    if (this.busy || this.rewindLock) {
        result = true;                  // unit busy or in RWL
    } else if (!this.ready) {
        result = true;                  // unit not ready
    } else if (this.atEOT) {
        result = true;                  // tape at EOT
    } else {
        this.busy = true;
        this.designatedLamp.set(1);
        this.setAtBOT(false);
        if (laneNr != this.laneNr) {
            this.laneNr = laneNr;
            startDelay += 70;           // additional time for lane change
        }

        // Begin with a delay for start-up time
        lane = this.image[this.laneNr];
        setCallback(this.mnemonic, this, startDelay, firstBlock);
    }

    //console.log(this.mnemonic + " searchBlock       result=" + result.toString());
    return result;
};

/**************************************/
B220MagTapeDrive.prototype.readBlock = function readBlock(blockReady, releaseControl) {
    /* Reads blocks on tape. "blockReady" is a function to be called after a
    block is read. "releaseControl" is a function to call after the control
    signals completion (see release). This routine is used for both MRD and MRR,
    as block lengths are determined by the tape control unit */
    var controlWord = 0;                // stashed control word for end-of-tape or control block
    var imgLength = this.imgLength;     // physical end of tape index
    var lane = this.image[this.laneNr]; // image data for current lane
    var result = false;
    var that = this;

    function release() {
        /* Releases the unit and control */

        that.releaseUnit(releaseControl, false);
    }

    function finish() {
        /* Wraps up the positioning and delays before releasing the unit and control */
        var delay = 18 - that.startTime - that.repositionTime;

        setCallback(that.mnemonic, that, delay, release);
    }

    function turnaround() {
        /* Repositions the tape after the last block is written */

        that.tapeReposition(finish);
    }

    function signalControl() {
        /* Returns to the tape control after encountering an end-of-tape block,
        using the control word stashed by readBlockNext. Note that tape must be
        positioned to read the block after the end-of-tape block, but we are
        already past the first word in the block, so we don't reposition backwards
        in this case -- just leave the tape where it is and normal pre-block
        scanning will find the next block */

        blockReady(false, true, controlWord, null, finish);
    }

    function repositionAndSignal() {
        /* Repositions the tape image so that the block following a control block
        can be read by the next operation. Then terminates the I/O */

        that.tapeReposition(signalControl);
    }

    function finalizeBlock() {
        /* Returns to the tape control after completion of one block */

        blockReady(false, false, 0, readBlockNext, turnaround);
    }

    function abort() {
        /* Aborts the I/O due to some error */

        blockReady(true, false, 0, null, release);
    }

    function repositionAndAbort() {
        /* Repositions the tape image so that the block causing the abort can be
        read by the next operation. Then aborts the I/O */

        that.tapeReposition(abort);
    }

    function setEOT() {
        /* Sets EOT status after positioning to end-of-tape. Does not release
        the control unit */

        that.setAtEOT(true);
        that.releaseUnit(null, false);
    }

    function advance (index, successor) {
        /* Advances the tape after a block is passed, then calls the successor */
        var len = index - that.imgIndex;    // number of words passed
        var delay = len*that.millisPerWord; // amount of tape spin time

        that.imgIndex = index;
        that.moveTape(len*that.inchesPerWord, delay, successor);
    }

    function readBlockNext(storeWord, record, controlEnabled) {
        /* Reads the next block in the tape image. "storeWord" is a call-back
        to store the next word to the Processor's memory. If "record" is true,
        the preface is stored in memory before the data. If "controlEnabled" is
        true, control blocks are recognized */
        var controlBlock = false;       // true if control block detected
        var count = 0;                  // word counter
        var done = false;               // completion flag
        var firstWord = true;           // flag for initial memory fetch
        var sign = 0;                   // sign digit of keyword
        var state = 1;                  // FSA state variable
        var words = 0;                  // number of words from preface
        var w;                          // current image word
        var x = that.imgIndex;          // lane image word index

        if (!that.ready) {
            done = true;                // drive went non-ready
            advance.call(that, x, abort);
        } else {
            do {
                if (x >= imgLength) {
                    done = true;        // at EOT: just exit and leave everybody hanging...
                    that.busy = false;
                    advance.call(that, x, setEOT);
                } else {
                    w = lane[x];

                    switch (state) {
                    case 1: // initial state: skip over flaw and intra-block words
                        if (w == that.markerGap) {
                            state = 2;
                        } else {
                            ++x;
                        }
                        break;

                    case 2: // skip over inter-block gap and magnetic EOT words
                        if (w == that.markerGap) {
                            ++x;
                        } else if (w == that.markerEOT) {
                            ++x;
                        } else if (w >= 0) {
                            state = 3;          // found the preface
                        } else {
                            done = true;        // not a formatted tape
                            advance.call(that, x, repositionAndAbort);
                        }
                        break;

                    case 3: // read the preface and check for EOT block
                        ++x;
                        words = w;
                        if (words == 1) {
                            state = 6;          // detected end-of-tape block
                        } else if (words < that.minBlockWords && words > 1) {
                            done = true;        // preface check: invalid block size
                            advance.call(that, x, abort);
                        } else {
                            state = 4;          // normal or control block
                        }
                        break;

                    case 4: // read the keyword, detect control block, and store the preface if necessary
                        ++x;
                        if (w < 0) {
                            done = true;        // block was shorter than preface indicated
                            advance.call(that, x-1, repositionAndAbort);
                        } else {
                            if (controlEnabled) {
                                sign = (w - w%0x10000000000)%0x10;
                                if (sign == 7) {
                                    controlBlock = true;
                                    // strip sign digit from keyword (not entirely sure this should be done)
                                    w %= 0x10000000000;
                                }
                            }

                            if (record) {       // store the preface word (with keyword sign if a control block)
                                sign = ((sign*0x10 + (words%100 - words%10)/10)*0x10 + words%10)*0x100000000;
                                done = (storeWord(firstWord, sign) < 0);        // true if memory error
                                firstWord = false;
                            }

                            if (controlBlock) {
                                --words;        // prevent storing the control word
                            }

                            if (done) {         // error storing preface word
                                advance.call(that, x, abort);
                            } else {
                                w = storeWord(firstWord, w);
                                if (w < 0) {
                                    done = true;        // keyword memory store failed
                                    advance.call(that, x, abort);
                                } else {
                                    firstWord = false;
                                    ++count;
                                    state = 5;
                                }
                            }
                        }
                        break;

                    case 5: // read and store the remaining block words
                        if (count < words) {
                            if (w < 0) {
                                done = true;    // block was shorter than preface indicated
                                advance.call(that, x-1, repositionAndAbort);
                            } else {
                                w = storeWord(firstWord, w);
                                if (w < 0) {
                                    done = true;        // memory store failed
                                    advance.call(that, x, abort);
                                } else {
                                    firstWord = false;
                                    ++x;
                                    ++count;
                                }
                            }
                        } else if (controlBlock) {
                            if (w < 0) {
                                done = true;    // block was shorter than preface indicated
                                advance.call(that, x-1, repositionAndAbort);
                            } else {
                                controlWord = w;
                                ++x;
                                state = 7;      // deal with the control word after EOB
                            }
                        } else {
                            state = 7;          // check for proper EOB
                        }
                        break;

                    case 6: // fetch the control word for an end-of-tape block and terminate
                        controlWord = w;
                        ++x;
                        done = true;            // signal end-of-tape block
                        advance.call(that, x, signalControl);
                        break;

                    case 7: // check for proper end-of-block and terminate
                        done = true;
                        if (w != that.markerEOB) {
                            advance.call(that, x, repositionAndAbort);
                        } else {                // block was longer than preface indicated
                            if (controlBlock) {
                                advance.call(that, x+that.endOfBlockWords, repositionAndSignal);
                            } else {
                                advance.call(that, x+that.endOfBlockWords, finalizeBlock);
                            }
                        }
                        break;
                    } // switch state
                }
            } while (!done);
        }
    }

    function firstBlock() {
        /* Called after the startTime delay to signal the control unit we are
        ready for the first block of data */

        blockReady(false, false, 0, readBlockNext, release);
    }

    if (this.busy || this.rewindLock) {
        result = true;                  // unit busy or in RWL
    } else if (!this.ready) {
        result = true;                  // unit not ready
    } else if (this.atEOT) {
        result = true;                  // tape at EOT
    } else {
        this.busy = true;
        this.designatedLamp.set(1);
        this.setAtBOT(false);

        // Begin with a delay for start-up time
        setCallback(this.mnemonic, this, this.startTime, firstBlock);
    }

    //console.log(this.mnemonic + " readBlock         result=" + result.toString());
    return result;
};

/**************************************/
B220MagTapeDrive.prototype.overwriteBlock = function overwriteBlock(blockReady, releaseControl) {
    /* Overwrites blocks on tape. "blockReady" is a function to be called after
    a block is overwritten. "releaseControl" is a function to call after the
    control signals completion (see release). This routine is used for both MOW
    and MOR, as block lengths are determined by the tape control unit */
    var controlWord = 0;                // stashed control word for end-of-tape block
    var imgLength = this.imgLength;     // physical end of tape index
    var lane = this.image[this.laneNr]; // image data for current lane
    var result = false;
    var that = this;

    function release() {
        /* Releases the unit and control */

        that.releaseUnit(releaseControl, false);
    }

    function finish() {
        /* Wraps up the positioning and delays before releasing the unit and control */
        var delay = 18 - that.startTime - that.repositionTime;

        setCallback(that.mnemonic, that, delay, release);
    }

    function turnaround() {
        /* Repositions the tape after the last block is written */

        that.tapeReposition(finish);
    }

    function signalControl() {
        /* Returns to the tape control after encountering an end-of-tape block,
        using the control word stashed by writeBlock. Note that tape must be
        positioned to read the block after the end-of-tape block, but we are
        already past the first word in the block, so we don't reposition backwards
        in this case -- just leave the tape where it is and normal pre-block
        scanning will find the next block */

        blockReady(false, true, controlWord, null, finish);
    }

    function finalizeBlock() {
        /* Returns to the tape control after completion of one block */

        blockReady(false, false, 0, writeBlock, turnaround);
    }

    function abort() {
        /* Aborts the I/O due to some error */

        blockReady(true, false, 0, null, release);
    }

    function repositionAndAbort() {
        /* Repositions the tape image so that the block causing the abort can be
        read by the next operation. Then aborts the I/O */

        that.tapeReposition(abort);
    }

    function setEOT() {
        /* Sets EOT status after positioning to end-of-tape. Does not release
        the control unit */

        that.setAtEOT(true);
        that.releaseUnit(null, false);
    }

    function advance (index, successor) {
        /* Advances the tape after a block is passed, then calls the successor */
        var len = index - that.imgIndex;    // number of words passed
        var delay = len*that.millisPerWord; // amount of tape spin time

        that.imgIndex = index;
        if (index > that.imgTopWordNr) {
            that.imgTopWordNr = index;
        }
        that.moveTape(len*that.inchesPerWord, delay, successor);
    }

    function writeBlock(fetchWord, words) {
        /* Overwrites the next block in the tape image. "fetchWord" is a call-back
        to retrieve the next word from the Processor's memory. "words" is the
        number of words in the block, 0 => "record" mode */
        var count = 0;                  // word counter
        var done = false;               // completion flag
        var firstWord = true;           // flag for initial memory fetch
        var state = 1;                  // FSA state variable
        var w;                          // current image word
        var x = that.imgIndex;          // lane image word index

        if (!that.ready) {
            done = true;                // drive went non-ready
            advance.call(that, x, abort);
        } else {
            do {
                if (x >= imgLength) {
                    done = true;        // at EOT: just exit and leave everybody hanging...
                    that.busy = false;
                    advance.call(that, x, setEOT);
                } else {
                    w = lane[x];

                    switch (state) {
                    case 1: // initial state: skip over flaw and intra-block words
                        if (w == that.markerGap) {
                            state = 2;
                        } else {
                            ++x;
                        }
                        break;

                    case 2: // skip over inter-block gap and magnetic EOT words
                        if (w == that.markerGap) {
                            ++x;
                        } else if (w == that.markerEOT) {
                            ++x;
                        } else if (w >= 0) {
                            state = 3;          // found the preface
                        } else {
                            done = true;        // not a formatted tape
                            advance.call(that, x, abort);
                        }
                        break;

                    case 3: // check the preface
                        ++x;
                        if (words <= 0) {       // overwrite, record: fetch preface
                            words = fetchWord(firstWord);
                            if (words < 0) {    // memory fetch failed
                                done = true;
                            } else {            // convert preface word to binary
                                firstWord = false;
                                words = ((words - words%0x100000000)/0x100000000)%0x100;
                                if (words > 0) {
                                    words = (words >>> 4)*10 + words%0x10;
                                } else {
                                    words = 100;        // preface == 0 => 100
                                }
                            }
                        }

                        if (done) {             // preface fetch failed
                            advance.call(that, x, abort);
                        } else if (w < that.minBlockWords && w > 1) {
                            done = true;        // preface check: invalid block size
                            advance.call(that, x, abort);
                        } else if (w == words) {
                            state = 4;          // preface match: overwrite the block
                        } else if (w == 1) {
                            state = 5;          // preface mismatch on end-of-tape block
                        } else {
                            done = true;        // other preface mismatch
                            advance.call(that, x, repositionAndAbort);
                        }
                        break;

                    case 4: // overwrite the block words
                        if (count < words) {
                            if (w < 0) {
                                done = true;    // block was shorter than preface indicated
                                advance.call(that, x-1, repositionAndAbort);
                            } else {
                                w = fetchWord(firstWord);
                                if (w < 0) {
                                    done = true;        // memory fetch failed
                                    advance.call(that, x, abort);
                                } else {
                                    firstWord = false;
                                    lane[x] = w;
                                    ++x;
                                    ++count;
                                }
                            }
                        } else if (count < that.minBlockWords) {
                            if (w < 0) {        // block was shorter than preface indicated
                                done = true;
                                advance.call(that, x-1, repositionAndAbort);
                            } else {
                                lane[x] = 0;
                                ++x;
                                ++count;
                            }
                        } else if (w == that.markerEOB) {
                            done = true;        // normal block termination
                            advance.call(that, x+that.endOfBlockWords, finalizeBlock);
                        } else {
                            done = true;        // block was longer than preface indicated
                            advance.call(that, x, repositionAndAbort);
                        }
                        break;

                    case 5: // fetch the control word for an end-of-tape preface mismatch and terminate
                        controlWord = w;
                        ++x;
                        done = true;            // signal end-of-tape block
                        advance.call(that, x, signalControl);
                        break;
                    } // switch state
                }
            } while (!done);
        }
    }

    function firstBlock() {
        /* Called after the startTime delay to signal the control unit we are
        ready for the first block of data */

        blockReady(false, false, 0, writeBlock, release);
    }

    if (this.busy || this.rewindLock) {
        result = true;                  // unit busy or in RWL
    } else if (!this.ready) {
        result = true;                  // unit not ready
    } else if (this.notWrite) {
        result = true;                  // tape in not-write status
    } else if (this.atEOT) {
        result = true;                  // tape at EOT
    } else {
        this.busy = true;
        this.imgWritten = true;
        this.designatedLamp.set(1);
        this.setAtBOT(false);

        // Begin with a delay for start-up time
        setCallback(this.mnemonic, this, this.startTime, firstBlock);
    }

    //console.log(this.mnemonic + " overwriteBlock    result=" + result.toString());
    return result;
};

/**************************************/
B220MagTapeDrive.prototype.initialWriteBlock = function initialWriteBlock(blockReady, releaseControl) {
    /* Writes blocks on edited (blank) tape. "blockReady" is a function to be
    called after the block is written. "releaseControl" is a function to call
    after the control signals completion (see release). This routine is used for
    both MIW and MIR, as block lengths are determined by the tape control unit */
    var imgLength = this.imgLength;     // physical end of tape index
    var lane = this.image[this.laneNr]; // image data for current lane
    var result = false;
    var that = this;

    function release() {
        /* Releases the unit and control */

        that.releaseUnit(releaseControl, false);
    }

    function finish() {
        /* Wraps up the positioning and delays before releasing the unit and control */
        var delay = 20 - that.startTime - that.repositionTime;

        setCallback(that.mnemonic, that, delay, release);
    }

    function turnaround() {
        /* Repositions the tape after the last block is written */

        that.tapeReposition(finish);
    }

    function finalizeWrite() {
        /* Write a longer inter-block gap so that MPE will work at magnetic
        end-of-tape, check for end-of-tape, and initiate repositioning prior
        to terminating the I/O */
        var count = that.startOfBlockWords*2; // number of gap words
        var done = false;               // loop control
        var x = that.imgIndex;          // lane image word index

        do {
            if (x >= imgLength) {
                done = true;            // at end-of-tape
                that.setAtEOT(true);
                advance.call(that, x, finish);
            } else if (count > 0) {
                --count;                // write extra inter-block gap word
                lane[x] = that.markerGap;
                ++x;
            } else if (lane[x] == that.markerMagEOT) {
                ++x;                    // space over magnetic EOT words
            } else {
                done = true;            // finish write and initiate repositioning
                advance.call(that, x, turnaround);
            }
        } while(!done);
    }

    function finalizeBlock() {
        /* Returns to the tape control after completion of one block */

        blockReady(false, writeBlock, finalizeWrite);
    }

    function abort() {
        /* Aborts the I/O due to some error */

        blockReady(true, null, release);
    }

    function setEOT() {
        /* Sets EOT status after positioning to end-of-tape. Does not release
        the control unit */

        that.setAtEOT(true);
        that.releaseUnit(null, false);
    }

    function advance (index, successor) {
        /* Advances the tape after a block is passed, then calls the successor */
        var len = index - that.imgIndex;    // number of words passed
        var delay = len*that.millisPerWord; // amount of tape spin time

        that.imgIndex = index;
        if (index > that.imgTopWordNr) {
            that.imgTopWordNr = index;
        }
        that.moveTape(len*that.inchesPerWord, delay, successor);
    }

    function writeBlock(fetchWord, words) {
        /* Initial-writes the next block in the tape image. "fetchWord" is a
        call-back to retrieve the next word from the Processor's memory.
        "words" is the number of words in the block, 0 => "record" mode */
        var count = 0;                  // word counter
        var done = false;               // completion flag
        var firstWord = true;           // flag for initial memory fetch
        var gapCount = 0;               // count of consecutive inter-block gap words
        var state = 1;                  // FSA state variable
        var w;                          // memory word
        var x = that.imgIndex;          // lane image word index

        if (!that.ready) {
            done = true;                // drive went non-ready
            advance.call(that, x, abort);
        } else {
            do {
                if (x >= imgLength) {
                    done = true;        // at EOT: just exit and leave everybody hanging...
                    that.busy = false;
                    advance.call(that, x, setEOT);
                } else {

                    switch (state) {
                    case 1: // initial state: skip over flaw and intra-block words
                        if (lane[x] == that.markerGap) {
                            state = 2;
                        } else {
                            ++x;
                        }
                        break;

                    case 2: // count 3 consecutive inter-block gap words
                        if (lane[x] == that.markerGap) {
                            ++gapCount;
                            if (gapCount < that.startOfBlockWords) {
                                ++x;
                            } else {
                                state = 3;
                            }
                        } else if (lane[x] == that.markerMagEOT) {
                            ++x;
                        } else {
                            done = true;        // not an edited tape
                            advance.call(that, x, abort);
                        }
                        break;

                    case 3: // write the preface
                        if (words <= 0) {       // initial-write, record: fetch preface
                            words = fetchWord(firstWord);
                            if (words < 0) {    // memory fetch failed
                                done = true;
                            } else {            // convert preface word to binary
                                firstWord = false;
                                words = ((words - words%0x100000000)/0x100000000)%0x100;
                                if (words > 0) {
                                    words = (words >>> 4)*10 + words%0x10;
                                } else {
                                    words = 100;        // preface == 0 => 100
                                }
                            }
                        }

                        if (done) {             // preface fetch failed
                            advance.call(that, x, abort);
                        } else if (words < that.minBlockWords && words > 1) {
                            done = true;        // invalid block size
                            advance.call(that, x, abort);
                        } else {
                            lane[x] = words;
                            ++x;
                            state = 4;
                        }
                        break;

                    case 4: // write the block words
                        if (count < words) {
                            w = fetchWord(firstWord);
                            if (w < 0) {
                                done = true;        // memory fetch failed
                                advance.call(that, x, abort);
                            } else {
                                firstWord = false;
                                lane[x] = w;
                                ++x;
                                ++count;
                            }
                        } else if (count < that.minBlockWords) {
                            lane[x] = 0;
                            ++x;
                            ++count;
                        } else {
                            count = 0;
                            state = 5;
                        }
                        break;

                    case 5: // write the erase gap
                        if (count < that.endOfBlockWords) {
                            lane[x] = that.markerEOB;
                            ++x;
                            ++count;
                        } else {
                            done = true;
                            advance.call(that, x, finalizeBlock);
                        }
                        break;
                    } // switch state
                }
            } while (!done);
        }
    }

    function firstBlock() {
        /* Called after the startTime delay to signal the control unit we are
        ready for the first block of data */

        blockReady(false, writeBlock, release);
    }

    if (this.busy || this.rewindLock) {
        result = true;                  // unit busy or in RWL
    } else if (!this.ready) {
        result = true;                  // unit not ready
    } else if (this.notWrite) {
        result = true;                  // tape in not-write status
    } else if (this.atEOT) {
        result = true;                  // tape at EOT
    } else {
        this.busy = true;
        this.imgWritten = true;
        this.designatedLamp.set(1);
        this.setAtBOT(false);

        // Begin with a delay for start-up time
        setCallback(this.mnemonic, this, this.startTime, firstBlock);
    }

    //console.log(this.mnemonic + " initialWriteBlock result=" + result.toString());
    return result;
};

/**************************************/
B220MagTapeDrive.prototype.positionForward = function positionForward(blockFinished, releaseControl) {
    /* Positions tape in a forward direction. "blockFinished" is a function  to
    be called after a block is spaced. "releaseControl" is a function to call
    after the last block is spaced (see spaceForward and turnaround) */
    var lane = this.image[this.laneNr]; // image data for current lane
    var result = false;
    var that = this;

    function release() {
        /* Releases the unit and control */

        that.releaseUnit(releaseControl, false);
    }

    function finish() {
        /* Wraps up the positioning and delays before releasing the unit and control */
        var delay = 16 - that.startTime - that.repositionTime;

        setCallback(that.mnemonic, that, delay, release);
    }

    function turnaround() {
        /* Repositions the tape after the last block is spaced over */

        that.tapeReposition(finish);
    }

    function setEOT() {
        /* Sets EOT status after positioning to end-of-tape. Does not release
        the control unit */

        that.setAtEOT(true);
        that.relaseUnit(null, false);
    }

    function advance (index, successor) {
        /* Advances the tape after a block is passed, then calls the successor */
        var len = index - that.imgIndex;    // number of words passed
        var delay = len*that.millisPerWord; // amount of tape spin time

        that.imgIndex = index;
        that.moveTape(len*that.inchesPerWord, delay, successor);
    }

    function spaceForward(blockFinished) {
        /* Spaces over the next block */
        var done = false;                   // completion flag
        var imgLength = that.imgLength;     // physical end of tape index
        var state = 1;                      // FSA state variable
        var w;                              // current image word
        var x = that.imgIndex;              // lane image word index

        do {
            if (x >= imgLength) {
                done = true;                // just exit and leave everybody hanging...
                that.busy = false;
                advance.call(that, x, setEOT);
            } else if (!that.ready) {
                done = true;
                that.busy = false;
                that.releaseUnit(releaseControl, true);
            } else {
                w = lane[x];

                switch (state) {
                case 1: // initial state: skip over flaw and intra-block words
                    if (w == that.markerGap) {
                        state = 2;
                    } else {
                        ++x;
                    }
                    break;

                case 2: // skip inter-block gap words
                    if (w != that.markerGap) {
                        state = 3;
                    } else {
                        ++x;
                    }
                    break;

                case 3: // search for end of block (next inter-block gap word)
                    if (w != that.markerGap) {
                        ++x;
                    } else {
                        done = true;
                        advance.call(that, x, function cb() {blockFinished(spaceForward, turnaround)});
                    }
                    break;
                } // switch state
            }
        } while (!done);

    }

    if (this.busy || this.rewindLock) {
        result = true;                  // unit busy or in RWL
    } else if (!this.ready) {
        result = true;                  // unit not ready
    } else if (this.atEOT) {
        result = true;                  // tape at EOT, leave control hung
    } else {
        this.busy = true;
        this.designatedLamp.set(1);
        this.setAtBOT(false);

        // Begin with a delay for start-up time
        setCallback(this.mnemonic, this, this.startTime, spaceForward, blockFinished);
    }

    //console.log(this.mnemonic + " positionForward   result=" + result.toString());
    return result;
};

/**************************************/
B220MagTapeDrive.prototype.positionBackward = function positionBackward(blockFinished, releaseControl) {
    /* Positions tape in a backward direction. "blockFinished" is a function to
    be called after a block is spaced. "releaseControl" is a function to call
    after the last block is spaced (see spaceBackward and finish) */
    var lane = this.image[this.laneNr]; // image data for current lane
    var result = false;
    var that = this;

    function release() {
        /* Releases the unit and control */

        that.releaseUnit(releaseControl, false);
    }

    function finish() {
        /* Wraps up the positioning and delays before releasing the unit and control */
        var delay = 6 - that.startTime;

        setCallback(that.mnemonic, that, delay, release);
    }

    function setBOT() {
        /* Sets BOT status after positioning to beginning-of-tape. Does not
        release the control unit */

        that.setAtBOT(true);
        that.releaseUnit(null, false);
    }

    function advance (index, successor) {
        /* Advances the tape after a block is passed, then calls the successor */
        var len = index - that.imgIndex;    // number of words passed
        var delay = len*that.millisPerWord; // amount of tape spin time

        that.imgIndex = index;
        that.moveTape(len*that.inchesPerWord, delay, successor);
    }

    function spaceBackward(blockFinished) {
        /* Spaces over the current or prior block until the inter-block gap */
        var done = false;                   // completion flag
        var state = 1;                      // FSA state variable
        var w;                              // current image word
        var x = that.imgIndex;              // lane image word index

        do {
            if (x <= 0) {
                done = true;                // just exit and leave everybody hanging...
                that.busy = false;
                advance.call(that, x, setBOT);
            } else if (!that.ready) {
                done = true;
                that.busy = false;
                that.releaseUnit(releaseControl, true);
            } else {
                w = lane[x];

                switch (state) {
                case 1: // initial state: skip over flaw words
                    if (w == that.markerGap) {
                        state = 2;
                    } else if (w == that.markerFlaw) {
                        --x;
                    } else {
                        state = 3;
                    }
                    break;

                case 2: // skip initial inter-block gap words
                    if (w != that.markerGap) {
                        state = 3;
                    } else {
                        --x;
                    }
                    break;

                case 3: // search for start of block (first prior inter-block gap word)
                    if (w != that.markerGap) {
                        --x;
                    } else {
                        state = 4;
                    }
                    break;

                case 4: // skip this block's inter-block gap words
                    if (w != that.markerGap) {
                        done = true;
                        x -= that.repositionWords;      // position into end of prior block, as usual
                        advance.call(that, x, function cb() {blockFinished(spaceBackward, finish)});
                    } else {
                        --x;
                    }
                    break;
                } // switch state
            }
        } while (!done);
    }

    if (this.busy || this.rewindLock) {
        result = true;                  // unit busy or in RWL
    } else if (!this.ready) {
        result = true;                  // unit not ready
    } else if (this.atBOT) {
        result = true;                  // tape at BOT, leave control hung
    } else {
        this.busy = true;
        this.designatedLamp.set(1);
        this.setAtEOT(false);

        // Begin with a delay for start-up time
        setCallback(this.mnemonic, this, this.startTime, spaceBackward, blockFinished);
    }

    //console.log(this.mnemonic + " positionBackward  result=" + result.toString());
    return result;
};

/**************************************/
B220MagTapeDrive.prototype.positionAtEnd = function positionAtEnd(releaseControl) {
    /* Positions the tape to the end of recorded information (i.e., gap longer
    and inter-block gap */
    var lane = this.image[this.laneNr]; // image data for current lane
    var result = false;
    var that = this;

    function release() {
        /* Releases the unit and control */

        that.releaseUnit(releaseControl, false);
    }

    function finish() {
        /* Wraps up the positioning and delays before releasing the unit and control */
        var delay = 23 - that.startTime - that.repositionTime;

        setCallback(that.mnemonic, that, delay, release);
    }

    function turnaround() {
        /* Repositions the tape after finding end-of-info */

        that.tapeReposition(finish);
    }

    function setEOT() {
        /* Sets EOT status after positioning to end-of-tape. Does not release
        the control unit */

        that.setAtEOT(true);
        that.relaseUnit(null, false);
    }

    function advance (index, successor) {
        /* Advances the tape after a block is passed, then calls the successor */
        var len = index - that.imgIndex;    // number of words passed
        var delay = len*that.millisPerWord; // amount of tape spin time

        that.imgIndex = index;
        that.moveTape(len*that.inchesPerWord, delay, successor);
    }

    function spaceForward() {
        /* Spaces over the next block, unless a long gap or physical EOT is
        encountered */
        var done = false;                   // completion flag
        var gapCount = 0;                   // number of consecutive erase-gap words
        var imgLength = that.imgLength;     // physical end of tape index
        var state = 1;                      // FSA state variable
        var w;                              // current image word
        var x = that.imgIndex;              // lane image word index

        do {
            if (x >= imgLength) {
                done = true;                // just exit and leave everybody hanging...
                that.busy = false;
                advance.call(that, x, setEOT);
            } else if (!that.ready) {
                done = true;
                that.busy = false;
                that.releaseUnit(releaseControl, true);
            } else {
                w = lane[x];

                switch (state) {
                case 1: // initial state: skip over flaw words
                    if (w == that.markerGap) {
                        state = 2;
                    } else if (w == that.markerFlaw) {
                        ++x;
                    } else {
                        state = 3;
                    }
                    break;

                case 2: // count inter-block gap words
                    if (w != that.markerGap) {
                        state = 3;
                    } else {
                        if (gapCount > that.startOfBlockWords) {
                            done = true;
                            advance.call(that, x, turnaround);
                        } else {
                            ++x;
                            ++gapCount;
                        }
                    }
                    break;

                case 3: // search for end of block (next inter-block gap word)
                    if (w != that.markerGap) {
                        ++x;
                    } else {
                        done = true;
                        advance.call(that, x, spaceForward);
                    }
                    break;
                } // switch state
            }
        } while (!done);

    }

    if (this.busy || this.rewindLock) {
        result = true;                  // unit busy or in RWL
    } else if (!this.ready) {
        result = true;                  // unit not ready
    } else if (this.atEOT) {
        result = true;                  // tape at EOT, leave control hung
    } else {
        this.busy = true;
        this.designatedLamp.set(1);
        this.setAtBOT(false);

        // Begin with a delay for start-up time
        setCallback(this.mnemonic, this, this.startTime, spaceForward);
    }

    //console.log(this.mnemonic + " positionAtEnd:    result=" + result.toString());
    return result;
};

/**************************************/
B220MagTapeDrive.prototype.laneSelect = function laneSelect(laneNr, releaseControl) {
    /* Selects the tape lane on the unit. If the drive is busy or not ready,
    returns true */
    delay = 3;                          // ms for a no-lane change
    var lane = laneNr%2;
    var result = false;

    if (this.busy || this.rewindLock) {
        result = true;                  // unit busy or in RWL
    } else if (!this.ready) {
        result = true;                  // unit not ready
    } else {
        this.busy = true;
        this.designatedLamp.set(1);
        if (this.laneNr != lane) {
            delay += 70;                // additional time (ms) if the lane changes
            this.laneNr = laneNr%2;
        }

        setCallback(this.mnemonic, this, delay, this.releaseUnit, releaseControl);
    }

    //console.log(this.mnemonic + " lane-select:      lane=" + laneNr + ", result=" + result.toString());
    return result;
};

/**************************************/
B220MagTapeDrive.prototype.rewind = function rewind(laneNr, lockout) {
    /* Initiates a rewind operation on the unit. If the drive is busy or not ready,
    returns true.  Otherwise, makes the drive not-ready, delays for an
    appropriate amount of time depending on how far up-tape we are, then readies the
    unit again */
    var result = false;

    if (this.busy || this.rewindLock) {
        result = true;                  // unit busy or in RWL
    } else if (!this.ready) {
        result = true;                  // unit not ready
    } else {
        this.designatedLamp.set(1);
        this.tapeRewind(laneNr, lockout);
    }

    //console.log(this.mnemonic + " rewind:           lane=" + laneNr + ", lockout=" + lockout + ", result=" + result.toString());
    return result;
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
