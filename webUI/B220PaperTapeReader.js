/***********************************************************************
* retro-220/webUI B220PaperTapeReader.js
************************************************************************
* Copyright (c) 2017, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* Burroughs 220 Paper Tape Reader module.
*
* Defines the paper tape input devices.
*
************************************************************************
* 2017-05-27  P.Kimpel
*   Original version, from retro-205 D205ConsoleInput.js.
***********************************************************************/
"use strict";

/**************************************/
function B220PaperTapeReader(mnemonic, unitIndex, config) {
    /* Constructor for the PaperTapeReader object */
    var top = unitIndex*32 + 264;
    var left = (unitIndex-1)*32 + 250;

    this.config = config;               // System configuration object
    this.mnemonic = mnemonic;           // Unit mnemonic
    this.unitIndex = unitIndex;         // Unit index into console output units
    this.inTimer = 0;                   // input setCallback() token

    this.charPeriod = B220PaperTapeReader.highSpeedPeriod;
                                        // paper-tape reader speed [ms/char]
    this.nextCharTime = 0;              // next time a character can be read
    this.unitMask = 0;                  // unit selection mask

    this.boundFlipSwitch = B220Util.bindMethod(this, B220PaperTapeReader.prototype.flipSwitch);
    this.boundReadTapeChar = B220Util.bindMethod(this, B220PaperTapeReader.prototype.readTapeChar);

    this.readResult = {                 // object passed back to Processor for each read
        code: 0,
        readChar: this.boundReadTapeChar
    };

    this.clear();

    // Create the reader window and onload event
    this.doc = null;
    this.tapeSupplyBar = null;
    this.tapeView = null;
    this.window = window.open("../webUI/B220PaperTapeReader.html", mnemonic,
            "location=no,scrollbars=no,resizable,width=420,height=160,left=" + left + ",top=" + top);
    this.window.addEventListener("load",
            B220Util.bindMethod(this, B220PaperTapeReader.prototype.readerOnload), false);
}

/**************************************/
B220PaperTapeReader.offSwitchImage = "./resources/ToggleDown.png";
B220PaperTapeReader.onSwitchImage = "./resources/ToggleUp.png";

B220PaperTapeReader.lowSpeedPeriod = 1000/500;
                                        // low reader speed: 500 cps
B220PaperTapeReader.highSpeedPeriod = 1000/1000;
                                        // high reader speed: 1000 cps
B220PaperTapeReader.startupTime = 5;    // reader start-up delay, ms
B220PaperTapeReader.idleTime = 50;      // idle time before reader requires start-up delay, ms

// Translate ANSI character codes to B220 charater codes.
        // Note that ANSI new-line sequences are used for end-of-word characters,
        // so "|" translates to B220 carriage-return (16). To avoid space-expansion
        // of tabs, "~" translates to tab (26). "_" translates to the "blank" code (02).
        // "^" translates to form-feed (15).
B220PaperTapeReader.xlate220 = [
    // 0     1     2     3     4     5     6     7     8     9     A     B     C     D     E     F
    0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x26, 0x16, 0x17, 0x15, 0x16, 0x17, 0x17, // 00-0F
    0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, // 10-1F
    0x00, 0x17, 0x17, 0x33, 0x13, 0x24, 0x10, 0x34, 0x24, 0x04, 0x14, 0x10, 0x23, 0x20, 0x03, 0x21, // 20-2F
    0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x17, 0x13, 0x04, 0x33, 0x17, 0x17, // 30-3F
    0x34, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56, // 40-4F
    0x57, 0x58, 0x59, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x17, 0x17, 0x17, 0x15, 0x02, // 50-5F
    0x17, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56, // 60-6F
    0x57, 0x58, 0x59, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x17, 0x16, 0x17, 0x26, 0x17, // 70-7F
    0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, // 80-8F
    0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, // 90-9F
    0x17, 0x17, 0x17, 0x17, 0x04, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, // A0-AF
    0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, // B0-BF
    0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, // C0-CF
    0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, // D0-DF
    0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, // E0-EF
    0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17, 0x17];// F0-FF

/**************************************/
B220PaperTapeReader.prototype.clear = function clear() {
    /* Initializes (and if necessary, creates) the reader unit state */

    this.ready = false;                 // a tape has been loaded into the reader
    this.busy = false;                  // a request for a digit is outstanding
    this.pendingReceiver = null;        // stashed digit-receiver function

    this.buffer = "";                   // reader input buffer (paper-tape reel)
    this.bufLength = 0;                 // current input buffer length (characters)
    this.bufIndex = 0;                  // 0-relative offset to next character to be read
};

/**************************************/
B220PaperTapeReader.prototype.$$ = function $$(e) {
    return this.doc.getElementById(e);
};

/**************************************/
B220PaperTapeReader.prototype.PRTapeSupplyBar_onclick = function PRTapeSupplyBar_onclick(ev) {
    /* Handle the click event for the "input hopper" meter bar */

    if (!this.ready) {
        if (this.window.confirm((this.bufLength-this.bufIndex).toString() + " of " + this.bufLength.toString() +
                     " characters remaining to read.\nDo you want to clear the reader input?")) {
            this.tapeView.value = "";
            this.setReaderEmpty();
        }
    }
};

/**************************************/
B220PaperTapeReader.prototype.fileSelector_onChange = function fileSelector_onChange(ev) {
    /* Handle the <input type=file> onchange event when files are selected. For each
    file, load it and add it to the input buffer of the reader */
    var tape;
    var f = ev.target.files;
    var that = this;
    var x;

    function fileLoader_onLoad(ev) {
        /* Handle the onload event for a Text FileReader */

        if (that.bufIndex >= that.bufLength) {
            that.buffer = ev.target.result;
        } else {
            switch (that.buffer.charAt(that.buffer.length-1)) {
            case "\r":
            case "\n":
                break;                  // do nothing -- the last word has a delimiter
            default:
                that.buffer += "\n";    // so the next tape starts on a new line
                break;
            }
            that.buffer = that.buffer.substring(that.bufIndex) + ev.target.result;
        }

        that.bufIndex = 0;
        that.bufLength = that.buffer.length;
        that.$$("PRTapeSupplyBar").value = that.bufLength;
        that.$$("PRTapeSupplyBar").max = that.bufLength;
        that.setReaderReady(true);
        if (that.busy && that.ready) {  // reinitiate the pending read
            that.readTapeChar(that.pendingReceiver);
            that.receiver = null;
        }
    }

    for (x=f.length-1; x>=0; x--) {
        tape = new FileReader();
        tape.onload = fileLoader_onLoad;
        tape.readAsText(f[x]);
    }
};

/**************************************/
B220PaperTapeReader.prototype.setReaderReady = function setReaderReady(ready) {
    /* Sets the reader to a ready or not-ready status */

    this.ready = ready && this.remoteSwitch.state && (this.bufIndex < this.bufLength);
    this.readyLamp.set(this.ready ? 1 : 0);
};

/**************************************/
B220PaperTapeReader.prototype.setReaderEmpty = function setReaderEmpty() {
    /* Sets the reader to a not-ready status and empties the buffer */

    this.setReaderReady(false);
    this.tapeSupplyBar.value = 0;
    this.buffer = "";                   // discard the input buffer
    this.bufLength = 0;
    this.bufIndex = 0;
    this.fileSelector.value = null; // reset the control so the same file can be reloaded
};

/**************************************/
B220PaperTapeReader.prototype.beforeUnload = function beforeUnload(ev) {
    var msg = "Closing this window will make the device unusable.\n" +
              "Suggest you stay on the page and minimize this window instead";

    ev.preventDefault();
    ev.returnValue = msg;
    return msg;
};


/**************************************/
B220PaperTapeReader.prototype.flipSwitch = function flipSwitch(ev) {
    /* Handler for switch clicks */
    var id = ev.target.id;
    var prefs = this.config.getNode("ConsoleInput.units", this.unitIndex);
    var x;

    switch (id) {
    case "RemoteSwitch":
        this.remoteSwitch.flip();
        prefs.remote = this.remoteSwitch.state;
        this.setReaderReady(this.remoteSwitch.state != 0);
        this.fileSelector.disabled = (this.remoteSwitch.state != 0);
        break;
    case "SpeedSwitch":
        this.speedSwitch.flip();
        prefs.speed = this.speedSwitch.state;
        this.charPeriod = (this.speedSwitch.state ? B220PaperTapeReader.highSpeedPeriod : B220PaperTapeReader.lowSpeedPeriod);
        break;
    case "UnitDesignateKnob":
        x = this.unitDesignateKnob.selectedIndex;
        if (x < 0) {
            x = this.unitDesignateKnob.length-1;
            this.unitMask = 0;
        } else {
            this.unitMask = B220Processor.pow2[x];
            prefs.unitMask = this.unitMask
        }
        break;
    }

    this.config.putNode("ConsoleInput.units", prefs, this.unitIndex);
    ev.preventDefault();
    ev.stopPropagation();
};

/**************************************/
B220PaperTapeReader.prototype.readerOnload = function readerOnload() {
    /* Initializes the reader window and user interface */
    var body;
    var mask;
    var prefs = this.config.getNode("ConsoleInput.units", this.unitIndex);
    var x;

    this.doc = this.window.document;
    //de = this.doc.documentElement;
    this.doc.title = "retro-220 - Reader - " + this.mnemonic;

    this.fileSelector = this.$$("PRFileSelector");
    this.tapeSupplyBar = this.$$("PRTapeSupplyBar");
    this.tapeView = this.$$("PRTapeView");

    body = this.$$("PaperTapeReader")
    this.remoteSwitch = new ToggleSwitch(body, null, null, "RemoteSwitch",
            B220PaperTapeReader.offSwitchImage, B220PaperTapeReader.onSwitchImage);
    this.remoteSwitch.set(prefs.remote);

    this.readyLamp = new ColoredLamp(body, null, null, "ReadyLamp", "blueLamp lampCollar", "blueLit");
    this.setReaderReady(this.remoteSwitch.state != 0);

    this.speedSwitch = new ToggleSwitch(body, null, null, "SpeedSwitch",
            B220PaperTapeReader.offSwitchImage, B220PaperTapeReader.onSwitchImage);
    this.speedSwitch.set(prefs.speed);
    this.charPeriod = (this.speedSwitch.state ? B220PaperTapeReader.highSpeedPeriod : B220PaperTapeReader.lowSpeedPeriod);

    this.unitDesignateKnob = this.$$("UnitDesignateKnob");
    mask = 0x001;
    this.unitMask = prefs.unitMask;
    if (this.unitMask == 0) {
        this.unitDesignateKnob.selectedIndex = this.unitDesignateKnob.length-1; // OFF
    } else {
        for (x=0; x<this.unitDesignateKnob.length; ++x) {
            if (this.unitMask & mask) {
                this.unitDesignateKnob.selectedIndex = x;
                break; // out of for loop
            } else {
                mask <<= 1;
            }
        }
    }

    this.fileSelector.disabled = (this.remoteSwitch.state != 0);

    // Events
    this.window.addEventListener("beforeunload",
            B220PaperTapeReader.prototype.beforeUnload, false);
    this.fileSelector.addEventListener("change",
            B220Util.bindMethod(this, B220PaperTapeReader.prototype.fileSelector_onChange));
    this.tapeSupplyBar.addEventListener("click",
            B220Util.bindMethod(this, B220PaperTapeReader.prototype.PRTapeSupplyBar_onclick));
    this.remoteSwitch.addEventListener("click", this.boundFlipSwitch);
    this.speedSwitch.addEventListener("click", this.boundFlipSwitch);
    this.unitDesignateKnob.addEventListener("change", this.boundFlipSwitch);

    //this.window.resizeBy(de.scrollWidth - this.window.innerWidth + 4, // kludge for right-padding/margin
    //                 de.scrollHeight - this.window.innerHeight);
};

/***********************************************************************
* Input Entry Points                                                   *
***********************************************************************/

/**************************************/
B220PaperTapeReader.prototype.initiateInput = function initiateInput(successor) {
    /* Initiates input to the reader. This simply calls this.readTapeChar(),
    which returns the first tape character (which should be the sign digit) to
    the processor and gets the ball rolling */
    var stamp = performance.now();

    if (stamp-this.nextCharTime < B220PaperTapeReader.idleTime) {
        this.readTapeChar(successor);
    } else {
        setCallback(this.mnemonic, this, B220PaperTapeReader.startupTime, this.readTapeChar, successor);
    }
};

/**************************************/
B220PaperTapeReader.prototype.sendTapeChar = function sendTapeChar(c, code, receiver) {
    /* Sends the character or EOW code read from the tape back to the
    Processor after an appropriate delay. Updates the TapeView display with the
    character sent */
    var delay;
    var length;
    var stamp = performance.now();
    var text = this.tapeView.value;

    this.readResult.code = code;
    if (this.nextCharTime < stamp) {
        delay = 0;
        this.nextCharTime = stamp + this.charPeriod;
    } else {
        delay = this.nextCharTime - stamp;
        this.nextCharTime += this.charPeriod;
    }

    this.inTimer = setCallback(this.mnemonic, this, delay, receiver, this.readResult);
    length = text.length;
    if (length < 120) {
        this.tapeView.value = text + String.fromCharCode(c);
        ++length;
    } else {
        this.tapeView.value = text.substring(length-119) + String.fromCharCode(c);
    }
    this.tapeView.setSelectionRange(length-1, length);
};

/**************************************/
B220PaperTapeReader.prototype.readTapeChar = function readTapeChar(receiver) {
    /* Reads one character frame from the paper-tape buffer and passes it to the
    "receiver" function. If at end-of-line, passes an end-of-word (0x35) code;
    an error or invalid character is passed as a 0x17 code. Otherwise, the ANSI
    character is translated to B220 code and that code is passed.
    If the buffer is empty (this.ready=false) or we are at end of buffer,
    simply exits after stashing a reference to the receiver function in
    this.pendingReceiver. This will leave the processor hanging until more tape
    is loaded into the reader or the processor is cleared. Once more tape is
    loaded, the fileSelector_onChange event will set ready, notice the hanging
    read (this.busy=true) and restart the read */
    var bufLength = this.bufLength;     // current buffer length
    var c;                              // current character ANSI code
    var x = this.bufIndex;              // current buffer index

    if (!this.ready) {
        this.busy = true;
        this.pendingReceiver = receiver;// stash the receiver until tape is loaded
        this.window.focus();            // call attention to the tape reader
    } else {
        this.busy = false;
        do {
            if (x >= bufLength) {       // end of buffer -- send finish
                this.sendTapeChar(0x20, 0x35, receiver);
                this.setReaderEmpty();
                break; // out of do loop
            } else {
                c = this.buffer.charCodeAt(x) % 0x100;
                if (c == 0x0D) { // carriage return -- send EOW and check for LF
                    if (++x < bufLength && this.buffer.charCodeAt(x) == 0x0A) {
                        ++x;
                    }
                    this.sendTapeChar(0x20, 0x35, receiver);
                    if (x >= bufLength) {
                        this.setReaderEmpty();
                    }
                    break; // out of do loop
                } else if (c == 0x0A) { // line feed -- send EOW
                    ++x;
                    this.sendTapeChar(0x20, 0x35, receiver);
                    if (x >= bufLength) {
                        this.setReaderEmpty();
                    }
                    break; // out of do loop
                } else {                // translate character and send its code
                    ++x;
                    this.sendTapeChar(c, B220PaperTapeReader.xlate220[c], receiver);
                    break; // out of do loop
                }
            }
        } while (true);

        this.tapeSupplyBar.value = bufLength-x;
        this.bufIndex = x;
    }
};

/**************************************/
B220PaperTapeReader.prototype.shutDown = function shutDown() {
    /* Shuts down the device */

    if (this.inTimer) {
        clearCallback(this.inTimer);
    }

    if (this.window) {
        this.window.removeEventListener("beforeunload", B220PaperTapeReader.prototype.beforeUnload, false);
        this.window.close();
        this.window = null;
    }
};
