/***********************************************************************
* retro-220/webUI B220PaperTapePunch.js
************************************************************************
* Copyright (c) 2017, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* Burroughs 220 High-Speed Paper Tape Punch device.
************************************************************************
* 2017-04-28  P.Kimpel
*   Original version, from retro-205 D205ConsoleOutput.js.
***********************************************************************/
"use strict";

/**************************************/
function B220PaperTapePunch(mnemonic, unitIndex, config) {
    /* Constructor for the Console Paper Tape Punch object */
    var top = unitIndex*32 + 264;
    var left = (unitIndex-1)*32;

    this.config = config;               // System configuration object
    this.mnemonic = mnemonic;           // Unit mnemonic
    this.unitIndex = unitIndex;         // Unit index into console output units
    this.outTimer = 0;                  // output setCallback() token

    this.nextCharTime = 0;              // next time a character can be punched
    this.unitMask = 0;                  // unit selection mask

    this.boundFlipSwitch = B220PaperTapePunch.prototype.flipSwitch.bind(this);
    this.boundReceiveSign = B220PaperTapePunch.prototype.receiveSign.bind(this);
    this.boundReceiveChar = B220PaperTapePunch.prototype.receiveChar.bind(this);

    this.clear();

    // Create the punch window and onload event
    this.doc = null;
    this.window = null;
    this.punchTape = null;
    this.punchEOP = null;
    B220Util.openPopup(window, "../webUI/B220PaperTapePunch.html", mnemonic,
            "location=no,scrollbars=no,resizable,width=240,height=160," +
                "left=" + left + ",top=" + top,
            this, B220PaperTapePunch.prototype.punchOnLoad);
}

/**************************************/
B220PaperTapePunch.offSwitchImage = "./resources/ToggleDown.png";
B220PaperTapePunch.onSwitchImage = "./resources/ToggleUp.png";

B220PaperTapePunch.charsPerSecond = 60; // Punch speed, characters/second
B220PaperTapePunch.charPeriod = 1000/B220PaperTapePunch.charsPerSecond;
                                        // Inter-character period, ms
B220PaperTapePunch.maxScrollLines = 45000;
                                        // Maximum amount of punch word scrollback

B220PaperTapePunch.codeXlate = [   // translate internal B220 code to ANSI
        // Note that ANSI new-line sequences are used for end-of-word characters,
        // so B220 carriage-return (16) translates to "|". To avoid space-expansion
        // of tabs (26), they are translated to "~". The 02 "blank" code is "_".
        // Form-feed (15) translates to "^".
        " ", "?", "_", ".", "\u00A4", "?",  "?",  "?", "?", "?", "!", "!", "!", "!", "!", "!",  // 00-0F
        "&", "?", "?", "$", "*",      "^",  "|",  "?", "?", "?", "!", "!", "!", "!", "!", "!",  // 10-1F
        "-", "/", "?", ",", "%",      "?",  "~",  "?", "?", "?", "!", "!", "!", "!", "!", "!",  // 20-2F
        "?", "?", "?", "#", "@",      "\\", "?",  "?", "?", "?", "!", "!", "!", "!", "!", "!",  // 30-3F
        "?", "A", "B", "C", "D",      "E",  "F",  "G", "H", "I", "!", "!", "!", "!", "!", "!",  // 40-4F
        "?", "J", "K", "L", "M",      "N",  "O",  "P", "Q", "R", "!", "!", "!", "!", "!", "!",  // 50-5F
        "?", "?", "S", "T", "U",      "V",  "W",  "X", "Y", "Z", "!", "!", "!", "!", "!", "!",  // 60-6F
        "?", "?", "?", "?", "?",      "?",  "?",  "?", "?", "?", "!", "!", "!", "!", "!", "!",  // 70-7F
        "0", "1", "2", "3", "4",      "5",  "6",  "7", "8", "9", "!", "!", "!", "!", "!", "!",  // 80-8F
        "?", "?", "?", "?", "?",      "?",  "?",  "?", "?", "?", "!", "!", "!", "!", "!", "!",  // 90-9F
        "!", "!", "!", "!", "!",      "!",  "!",  "!", "!", "!", "!", "!", "!", "!", "!", "!",  // A0-AF
        "!", "!", "!", "!", "!",      "!",  "!",  "!", "!", "!", "!", "!", "!", "!", "!", "!",  // B0-BF
        "!", "!", "!", "!", "!",      "!",  "!",  "!", "!", "!", "!", "!", "!", "!", "!", "!",  // C0-CF
        "!", "!", "!", "!", "!",      "!",  "!",  "!", "!", "!", "!", "!", "!", "!", "!", "!",  // D0-DF
        "!", "!", "!", "!", "!",      "!",  "!",  "!", "!", "!", "!", "!", "!", "!", "!", "!",  // E0-EF
        "!", "!", "!", "!", "!",      "!",  "!",  "!", "!", "!", "!", "!", "!", "!", "!", "!"]; // F0-FF


/**************************************/
B220PaperTapePunch.prototype.clear = function clear() {
    /* Initializes (and if necessary, creates) the SPO unit state */

    this.ready = false;                 // ready status
    this.busy = false;                  // busy status
};

/**************************************/
B220PaperTapePunch.prototype.$$ = function $$(e) {
    return this.doc.getElementById(e);
};

/**************************************/
B220PaperTapePunch.prototype.punchEmptyPaper = function punchEmptyPaper() {
    /* Empties the punch output "paper" and initializes it for new output */

    while (this.punchTape.firstChild) {
        this.punchTape.removeChild(this.punchTape.firstChild);
    }
    this.punchTape.appendChild(this.doc.createTextNode(""));
};

/**************************************/
B220PaperTapePunch.prototype.punchEmptyLine = function punchEmptyLine(text) {
    /* Removes excess lines already output, then appends a new text node to the
   <pre> element within the paper element. Note that "text" is an ANSI string */
    var paper = this.punchTape;
    var line = text || "";

    while (paper.childNodes.length > B220PaperTapePunch.maxScrollLines) {
        paper.removeChild(paper.firstChild);
    }
    paper.lastChild.nodeValue += "\n";     // newline
    paper.appendChild(this.doc.createTextNode(line));
    this.punchEOP.scrollIntoView();
};

/**************************************/
B220PaperTapePunch.prototype.punchChar = function punchChar(code) {
    /* Outputs the character "code" to the device */
    var c = B220PaperTapePunch.codeXlate[code];
    var line;
    var len;

    if (c != "?") {                     // some 220 codes just don't print
        line = this.punchTape.lastChild.nodeValue;
        len = line.length;
        if (len < 1) {
            this.punchTape.lastChild.nodeValue = c;
        } else {
            this.punchTape.lastChild.nodeValue = line + c;
        }
    }
};

/**************************************/
B220PaperTapePunch.prototype.beforeUnload = function beforeUnload(ev) {
    var msg = "Closing this window will make the device unusable.\n" +
              "Suggest you stay on the page and minimize this window instead";

    ev.preventDefault();
    ev.returnValue = msg;
    return msg;
};

/**************************************/
B220PaperTapePunch.prototype.resizeWindow = function resizeWindow(ev) {
    /* Handles the window onresize event by scrolling the "tape" so it remains at the end */

    this.punchEOP.scrollIntoView();
};

/**************************************/
B220PaperTapePunch.prototype.punchCopyTape = function punchCopyTape(ev) {
    /* Copies the text contents of the "paper" area of the device, opens a new
    temporary window, and pastes that text into the window so it can be copied
    or saved by the user */
    var text = this.punchTape.textContent;
    var title = "B220 " + this.mnemonic + " Text Snapshot";

    B220Util.openPopup(this.window, "./B220FramePaper.html", "",
            "scrollbars,resizable,width=500,height=500",
            this, function(ev) {
        var doc = ev.target;
        var win = doc.defaultView;

        doc.title = title;
        win.moveTo((screen.availWidth-win.outerWidth)/2, (screen.availHeight-win.outerHeight)/2);
        doc.getElementById("Paper").textContent = text;
    });

    this.punchEmptyPaper();
    ev.preventDefault();
    ev.stopPropagation();
};

/**************************************/
B220PaperTapePunch.prototype.flipSwitch = function flipSwitch(ev) {
    /* Handler for switch clicks */
    var id = ev.target.id;
    var prefs = this.config.getNode("ConsoleOutput.units", this.unitIndex);
    var x;

    switch (id) {
    case "RemoteSwitch":
        this.remoteSwitch.flip();
        prefs.remote = this.remoteSwitch.state;
        this.ready = (this.remoteSwitch.state != 0);
        this.readyLamp.set(this.remoteSwitch.state);
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

    this.config.putNode("ConsoleOutput.units", prefs, this.unitIndex);
    ev.preventDefault();
    ev.stopPropagation();
};

/**************************************/
B220PaperTapePunch.prototype.punchOnLoad = function punchOnLoad(ev) {
    /* Initializes the Paper Tape Punch window and user interface */
    var body;
    var mask;
    var prefs = this.config.getNode("ConsoleOutput.units", this.unitIndex);
    var x;

    this.doc = ev.target;
    this.window = this.doc.defaultView;
    this.doc.title = "retro-220 Punch - " + this.mnemonic;

    this.punchTape = this.$$("Paper");
    this.punchEOP = this.$$("EndOfPaper");
    this.punchEmptyPaper();

    body = this.$$("PaperTapePunch")
    this.remoteSwitch = new ToggleSwitch(body, null, null, "RemoteSwitch",
            B220PaperTapePunch.offSwitchImage, B220PaperTapePunch.onSwitchImage);
    this.remoteSwitch.set(prefs.remote);
    this.ready = (this.remoteSwitch.state != 0);

    this.readyLamp = new ColoredLamp(body, null, null, "ReadyLamp", "blueLamp lampCollar", "blueLit");
    this.readyLamp.set(this.remoteSwitch.state);

    this.unitDesignateKnob = this.$$("UnitDesignateKnob");
    mask = 0x001;
    this.unitMask = prefs.unitMask;
    if (this.unitMask == 0) {
        this.unitDesignateKnob.selectedIndex = this.unitDesignateKnob.length-1;
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

    // Events
    this.window.addEventListener("beforeunload",
            B220PaperTapePunch.prototype.beforeUnload, false);
    this.window.addEventListener("resize",
            B220PaperTapePunch.prototype.resizeWindow.bind(this), false);
    this.punchTape.addEventListener("dblclick",
            B220PaperTapePunch.prototype.punchCopyTape.bind(this), false);
    this.remoteSwitch.addEventListener("click", this.boundFlipSwitch);
    this.unitDesignateKnob.addEventListener("change", this.boundFlipSwitch);

    //this.punchWin.resizeBy(screen.availWidth - this.punchWin.outerWidth,
    //                   screen.availHeight - this.punchWin.outerHeight);
    //this.punchWin.moveTo(0, 430);
    this.window.focus();
};

/***********************************************************************
* Output Entry Points                                                  *
***********************************************************************/

/**************************************/
B220PaperTapePunch.prototype.initiateOutput = function initiateOutput(successor) {
    /* Initiates output to the punch. This simply calls the successor function,
    passing our receiver function, so the processor can get the ball rolling */

    successor(this.boundReceiveSign);
};

/**************************************/
B220PaperTapePunch.prototype.receiveSign = function receiveSign(char, successor) {
    /* Receives the sign character from the processor and handles it according
    to the value of the sign and the setting of the Map Memory and LZ Suppress
    switches */
    var delay = B220PaperTapePunch.charPeriod;  // default character delay
    var stamp = performance.now();              // current time

    this.punchChar(char);                       // punch the sign

    if (this.nextCharTime <= stamp) {
        this.nextCharTime = stamp;
    }

    setCallback(this.mnemonic, this, this.nextCharTime-stamp+delay, successor, this.boundReceiveChar);
    this.nextCharTime += delay;
};

/**************************************/
B220PaperTapePunch.prototype.receiveChar = function receiveChar(char, successor) {
    /* Receives a non-sign character from the processor and outputs it. Special handling
    is provided for tabs, carriage returns, form feeds, and end-of-word characters */
    var delay = B220PaperTapePunch.charPeriod;  // default character delay
    var nextReceiver = this.boundReceiveChar;   // default routine to receive next char
    var stamp = performance.now();              // current time

    switch (char) {
    case 0x35:                          // end-of-word
        delay = 0;
        this.punchEmptyLine();
        nextReceiver = this.boundReceiveSign;   // next will be start of a new word
        break;

    default:                            // all others
        this.punchChar(char);
        break;
    } // switch char

    setCallback(this.mnemonic, this, this.nextCharTime-stamp+delay, successor, nextReceiver);
    this.nextCharTime += delay;
};

/**************************************/
B220PaperTapePunch.prototype.shutDown = function shutDown() {
    /* Shuts down the device */

    if (this.outTimer) {
        clearCallback(this.outTimer);
    }

    if (this.window) {
        this.window.removeEventListener("beforeunload",
            B220PaperTapePunch.prototype.beforeUnload, this);
        this.window.close();
        this.window = null;
    }
};
