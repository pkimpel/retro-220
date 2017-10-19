/***********************************************************************
* retro-220/webUI B220ConsolePrinter.js
************************************************************************
* Copyright (c) 2017, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* Burroughs 220 Console Printer and
* High-Speed Paper Tape Punch devices.
************************************************************************
* 2017-03-17  P.Kimpel
*   Original version, from retro-205 D205ConsoleOutput.js.
***********************************************************************/
"use strict";

/**************************************/
function B220ConsolePrinter(mnemonic, unitIndex, config) {
    /* Constructor for the Console Printer object */
    var top = unitIndex*32;
    var left = unitIndex*32;

    this.config = config;               // System configuration object
    this.mnemonic = mnemonic;           // Unit mnemonic
    this.unitIndex = unitIndex;         // Unit index into console output units
    this.outTimer = 0;                  // output setCallback() token

    this.columns = 72;                  // right-margin auto-return position
    this.format = 0;                    // 0=space, 1=tab, 2=carriage-return
    this.nextCharTime = 0;              // next time a character can be printed
    this.mapMemory = 0;                 // map-memory switch setting
    this.unitMask = 0;                  // unit selection mask
    this.unitSwitch = new Array(11);    // unit selection switch objects
    this.tabStop = [];                  // 0-relative tab stop positions
    this.zeroSuppress = 0;              // zero-suppression switch setting

    this.boundButton_Click = B220Util.bindMethod(this, B220ConsolePrinter.prototype.button_Click);
    this.boundText_OnChange = B220Util.bindMethod(this, B220ConsolePrinter.prototype.text_OnChange);
    this.boundFlipSwitch = B220Util.bindMethod(this, B220ConsolePrinter.prototype.flipSwitch);
    this.boundReceiveSign = B220Util.bindMethod(this, B220ConsolePrinter.prototype.receiveSign);
    this.boundReceiveChar = B220Util.bindMethod(this, B220ConsolePrinter.prototype.receiveChar);

    this.clear();

    // Create the printer window and onload event
    this.doc = null;
    this.paper = null;
    this.printerEOP = null;
    this.printerLine = 0;
    this.printerCol = 0;
    this.window = window.open("../webUI/B220ConsolePrinter.html", mnemonic,
            "location=no,scrollbars=no,resizable,width=640,height=240," +
            "left=" + left + ",top=" + top);
    this.window.addEventListener("load", B220Util.bindMethod(this,
            B220ConsolePrinter.prototype.printerOnLoad));
}

/**************************************/
B220ConsolePrinter.offSwitchImage = "./resources/ToggleDown.png";
B220ConsolePrinter.onSwitchImage = "./resources/ToggleUp.png";

B220ConsolePrinter.charsPerSecond = 10; // Printer speed
B220ConsolePrinter.charPeriod = 1000/B220ConsolePrinter.charsPerSecond;
                                        // Inter-character period, ms
B220ConsolePrinter.pageSize = 66;       // lines/page for form-feed
B220ConsolePrinter.maxScrollLines = 15000;
                                        // Maximum amount of paper scrollback

B220ConsolePrinter.codeXlate = [   // translate internal B220 code to ANSI
        " ", "?", " ", ".", "\u00A4", "?",  "?",  "?", "?", "?", "?", "?", "?", "?", "?", "?",  // 00-0F
        "&", "?", "?", "$", "*",      "\f", "\n", "?", "?", "?", "?", "?", "?", "?", "?", "?",  // 10-1F
        "-", "/", "?", ",", "%",      "?",  "\t", "?", "?", "?", "?", "?", "?", "?", "?", "?",  // 20-2F
        "?", "?", "?", "#", "@",      "!",  "?",  "?", "?", "?", "?", "?", "?", "?", "?", "?",  // 30-3F
        "?", "A", "B", "C", "D",      "E",  "F",  "G", "H", "I", "?", "?", "?", "?", "?", "?",  // 40-4F
        "?", "J", "K", "L", "M",      "N",  "O",  "P", "Q", "R", "?", "?", "?", "?", "?", "?",  // 50-5F
        "?", "?", "S", "T", "U",      "V",  "W",  "X", "Y", "Z", "?", "?", "?", "?", "?", "?",  // 60-6F
        "?", "?", "?", "?", "?",      "?",  "?",  "?", "?", "?", "?", "?", "?", "?", "?", "?",  // 70-7F
        "0", "1", "2", "3", "4",      "5",  "6",  "7", "8", "9", "?", "?", "?", "?", "?", "?",  // 80-8F
        "?", "?", "?", "?", "?",      "?",  "?",  "?", "?", "?", "?", "?", "?", "?", "?", "?"]; // 90-9F


/**************************************/
B220ConsolePrinter.prototype.clear = function clear() {
    /* Initializes (and if necessary, creates) the SPO unit state */

    this.ready = false;                 // ready status
    this.busy = false;                  // busy status

    this.eowAction = 0;                 // 1 => End-of-Word action needed
    this.suppressLZ = 0;                // 1 => currently suppressing leading zeroes
};

/**************************************/
B220ConsolePrinter.prototype.beforeUnload = function beforeUnload(ev) {
    var msg = "Closing this window will make the device unusable.\n" +
              "Suggest you stay on the page and minimize this window instead";

    ev.preventDefault();
    ev.returnValue = msg;
    return msg;
};

/**************************************/
B220ConsolePrinter.prototype.$$ = function $$(e) {
    return this.doc.getElementById(e);
};

/**************************************/
B220ConsolePrinter.prototype.emptyPaper = function emptyPaper() {
    /* Empties the printer output "paper" and initializes it for new output */

    while (this.paper.firstChild) {
        this.paper.removeChild(this.paper.firstChild);
    }
    this.paper.appendChild(this.doc.createTextNode(""));
};

/**************************************/
B220ConsolePrinter.prototype.emptyLine = function emptyLine(text) {
    /* Removes excess lines already output, then appends a new text node to the
   <pre> element within the paper element. Note that "text" is an ANSI string */
    var paper = this.paper;
    var line = text || "";

    while (paper.childNodes.length > B220ConsolePrinter.maxScrollLines) {
        paper.removeChild(paper.firstChild);
    }
    paper.lastChild.nodeValue += "\n";     // newline
    paper.appendChild(this.doc.createTextNode(line));
    ++this.printerLine;
    this.printerCol = line.length;
    this.printerEOP.scrollIntoView();
};

/**************************************/
B220ConsolePrinter.prototype.printChar = function printChar(code) {
    /* Outputs the character "code" to the device */
    var c = B220ConsolePrinter.codeXlate[code];
    var line;
    var len;

    if (c != "?") {                     // some 220 codes just don't print
        line = this.paper.lastChild.nodeValue;
        len = line.length;
        if (len < 1) {
            this.paper.lastChild.nodeValue = c;
            this.printerCol = 1;
        } else if (len < this.columns) {
            this.paper.lastChild.nodeValue = line + c;
            ++this.printerCol;
        } else {
             this.emptyLine(c);
        }
    }
};

/**************************************/
B220ConsolePrinter.prototype.printTab = function printTab() {
    /* Simulates tabulation by outputting an appropriate number of spaces */
    var tabCol;                         // tabulation column
    var x;                              // scratch index

    for (x=0; x<this.tabStop.length; ++x) {
        if (this.tabStop[x] > this.printerCol) {
            tabCol = this.tabStop[x];
            break; // out of for loop
        }
    } // for x

    if (this.columns < tabCol) {
        this.emptyLine();                   // tab would overflow right margin
    } else {
        while (this.printerCol < tabCol) {
            this.printChar(0x00);           // output a space
        }
    }
};

/**************************************/
B220ConsolePrinter.prototype.printFormFeed = function printFormFeed() {
    /* Simulates a form feed by outputting an appropriate number of blank lines */

    this.printerLine %= B220ConsolePrinter.pageSize;
    while (this.printerLine < B220ConsolePrinter.pageSize) {
        this.emptyLine();
    }
};

/**************************************/
B220ConsolePrinter.prototype.resizeWindow = function resizeWindow(ev) {
    /* Handles the window onresize event by scrolling the "paper" so it remains at the end */

    this.printerEOP.scrollIntoView();
};

/**************************************/
B220ConsolePrinter.prototype.copyPaper = function copyPaper(ev) {
    /* Copies the text contents of the "paper" area of the device, opens a new
    temporary window, and pastes that text into the window so it can be copied
    or saved by the user */
    var text = this.paper.textContent;
    var title = "B220 " + this.mnemonic + " Text Snapshot";
    var win = window.open("./B220FramePaper.html", "TTY-Snapshot",
            "scrollbars,resizable,width=500,height=500");

    win.moveTo((screen.availWidth-win.outerWidth)/2, (screen.availHeight-win.outerHeight)/2);
    win.addEventListener("load", function() {
        var doc;

        doc = win.document;
        doc.title = title;
        doc.getElementById("Paper").textContent = text;
    });

    this.emptyPaper();
    this.emptyLine();
    ev.preventDefault();
    ev.stopPropagation();
};

/**************************************/
B220ConsolePrinter.prototype.button_Click = function button_Click(ev) {
    /* Handler for button clicks */

    switch (ev.target.id) {
    case "LineFeedBtn":
        this.emptyLine();
        break;
    case "CarriageReturnBtn":
        if (this.printerCol > 0) {
            this.emptyLine();
        }
        break;
    case "OpenPanelBtn":
        ev.target.disabled = true;
        this.$$("FormatControlsDiv").style.display = "block";
        break;
    case "ClosePanelBtn":
        this.$$("OpenPanelBtn").disabled = false;
        this.$$("FormatControlsDiv").style.display = "none";
        break;
    } // switch ev.target.id

    ev.preventDefault();
    ev.stopPropagation();
};

/**************************************/
B220ConsolePrinter.prototype.flipSwitch = function flipSwitch(ev) {
    /* Handler for switch clicks */
    var id = ev.target.id;
    var prefs = this.config.getNode("ConsoleOutput.units", this.unitIndex);
    var x;

    switch (id) {
    case "ZeroSuppressSwitch":
        this.zeroSuppressSwitch.flip();
        prefs.zeroSuppress = this.zeroSuppress = this.zeroSuppressSwitch.state;
        break;
    case "MapMemorySwitch":
        this.mapMemorySwitch.flip();
        prefs.mapMemory, this.mapMemory = this.mapMemorySwitch.state;
        break;
    case "RemoteKnob":
        this.remoteKnob.step();
        prefs.remote = this.remoteKnob.position;
        this.ready = (this.remoteKnob.position != 0);
        break;
    case "FormatKnob":
        this.formatKnob.step();
        prefs.format = this.formatKnob.position;
        this.format = this.formatKnob.position;
        break;
    default:
        x = id.indexOf("UnitSwitch");
        if (x == 0) {
            x = parseInt(id.substring(10), 10);
            if (!isNaN(x)) {
                this.unitSwitch[x].flip();
                this.unitMask ^= B220Processor.pow2[x];
                prefs.unitMask = this.unitMask;
            }
        }
        break;
    }

    this.config.putNode("ConsoleOutput.units", prefs, this.unitIndex);
    ev.preventDefault();
    ev.stopPropagation();
};

/**************************************/
B220ConsolePrinter.prototype.text_OnChange = function text_OnChange(ev) {
    /* Handler for text onchange events */
    var prefs = this.config.getNode("ConsoleOutput.units", this.unitIndex);
    var text = ev.target.value;
    var v;

    switch (ev.target.id) {
    case "Columns":
        v = parseInt(text, 10);
        if (!isNaN(v)) {
            this.columns = v;
            ev.target.value = text = v.toFixed();
            prefs.columns = v;
        }
        break;
    case "TabStops":
        v = this.parseTabStops(prefs.tabs || "", this.window);
        if (v !== null) {
            this.tabStop = v;
            ev.target.value = text = v.join(",");
            prefs.tabs = text;
        }
        break;
    } // switch ev.target.id

    this.config.putNode("ConsoleOutput.units", prefs, this.unitIndex);
    ev.preventDefault();
    ev.stopPropagation();
};

/**************************************/
B220ConsolePrinter.prototype.parseTabStops = function parsetabStops(text, alertWin) {
    /* Parses a comma-delimited list of 1-relative tab stops. If the list is parsed
    successfully, returns an array of 0-relative tab stop positions; otherwise
    returns null. An alert is displayed on the window for the first parsing or
    out-of-sequence error */
    var col;
    var cols;
    var copacetic = true;
    var lastCol = 0;
    var raw;
    var x;
    var tabStop = [];

    if (text.search(/\S/) >= 0) {
        cols = text.split(",");
        for (x=0; x<cols.length; ++x) {
            raw = cols[x].trim();
            if (raw.length > 0) {       // ignore empty fields
                col = parseInt(raw, 10);
                if (isNaN(col)) {
                    copacetic = false;
                    alertWin.alert("Tab stop #" + (x+1) + " (\"" + cols[x] + "\") is not numeric");
                    break; // out of for loop
                } else if (col <= lastCol) {
                    copacetic = false;
                    alertWin.alert("Tab stop #" + (x+1) + " (\"" + col + "\") is out of sequence");
                    break; // out of for loop
                } else {
                    lastCol = col;
                    tabStop.push(col-1);
                }
            }
        } // for x
    }

    return (copacetic ? tabStop : null);
};

/**************************************/
B220ConsolePrinter.prototype.printerOnLoad = function printerOnLoad() {
    /* Initializes the Teletype printer window and user interface */
    var body;
    var id;
    var mask;
    var prefs = this.config.getNode("ConsoleOutput.units", this.unitIndex);
    var tabStop;
    var x;

    this.doc = this.window.document;
    this.doc.title = "retro-220 Printer - " + this.mnemonic;
    this.paper = this.$$("Paper");
    this.printerEOP = this.$$("EndOfPaper");
    this.emptyPaper();
    this.emptyLine();

    body = this.$$("FormatControlsDiv");
    this.remoteKnob = new BlackControlKnob(body, null, null, "RemoteKnob",
        prefs.remote, [20, -20]);
    this.ready = (prefs.remote != 0);

    this.zeroSuppressSwitch = new ToggleSwitch(body, null, null, "ZeroSuppressSwitch",
            B220ConsolePrinter.offSwitchImage, B220ConsolePrinter.onSwitchImage);
    this.zeroSuppressSwitch.set(prefs.zeroSuppress);
    this.zeroSuppress = this.zeroSuppressSwitch.state;
    this.mapMemorySwitch = new ToggleSwitch(body, null, null, "MapMemorySwitch",
            B220ConsolePrinter.offSwitchImage, B220ConsolePrinter.onSwitchImage);
    this.mapMemorySwitch.set(prefs.mapMemory);
    this.mapMemory = this.mapMemorySwitch.state;

    mask = 0x001;
    this.unitMask = prefs.unitMask;
    for (x=0; x<this.unitSwitch.length; ++x) {
        id = "UnitSwitch" + x.toFixed();
        this.unitSwitch[x] = new ToggleSwitch(body, null, null, id,
                B220ConsolePrinter.offSwitchImage, B220ConsolePrinter.onSwitchImage);
        this.unitSwitch[x].set(prefs.unitMask & mask ? 1 : 0);
        this.unitSwitch[x].addEventListener("click", this.boundFlipSwitch);
        mask <<= 1;
    }

    this.formatKnob = new BlackControlKnob(body, null, null, "FormatKnob",
        prefs.format, [-30, 0, 30]);
    this.format = prefs.format;

    this.columns = prefs.columns;
    this.$$("Columns").value = prefs.columns.toFixed();

    tabStop = this.parseTabStops(prefs.tabs || "", this.window);
    if (tabStop !== null) {
        this.tabStop = tabStop;
        this.$$("TabStops").value = tabStop.join(",");
    }

    // Events
    this.window.addEventListener("beforeunload",
            B220ConsolePrinter.prototype.beforeUnload);
    this.window.addEventListener("resize",
            B220Util.bindMethod(this, B220ConsolePrinter.prototype.resizeWindow));
    this.paper.addEventListener("dblclick",
            B220Util.bindMethod(this, B220ConsolePrinter.prototype.copyPaper));

    this.$$("OpenPanelBtn").addEventListener("click", this.boundButton_Click);
    this.$$("ClosePanelBtn").addEventListener("click", this.boundButton_Click);
    this.$$("LineFeedBtn").addEventListener("click", this.boundButton_Click);
    this.$$("CarriageReturnBtn").addEventListener("click", this.boundButton_Click);

    this.zeroSuppressSwitch.addEventListener("click", this.boundFlipSwitch);
    this.mapMemorySwitch.addEventListener("click", this.boundFlipSwitch);
    this.remoteKnob.addEventListener("click", this.boundFlipSwitch);
    this.formatKnob.addEventListener("click", this.boundFlipSwitch);
    this.$$("Columns").addEventListener("change", this.boundText_OnChange);
    this.$$("TabStops").addEventListener("change", this.boundText_OnChange);

    this.window.focus();
};

/***********************************************************************
* Output Entry Points                                                  *
***********************************************************************/

/**************************************/
B220ConsolePrinter.prototype.initiateOutput = function initiateOutput(successor) {
    /* Initiates output to the printer. This simply calls the successor function,
    passing our receiver function, so the processor can get the ball rolling */

    successor(this.boundReceiveSign);
};

/**************************************/
B220ConsolePrinter.prototype.receiveSign = function receiveSign(char, successor) {
    /* Receives the sign character from the processor and handles it according
    to the value of the sign and the setting of the Map Memory and LZ Suppress
    switches */
    var delay = B220ConsolePrinter.charPeriod;  // default character delay
    var stamp = performance.now();              // current time

    switch (true) {
    case this.mapMemory != 0:                   // transparent output
        this.eowAction = 1;
        this.suppressLZ = 0;
        this.printChar(char);
        break;

    case char == 0x82:                          // sign = 2, print alphanumeric
        this.eowAction = 0;
        this.suppressLZ = 0;
        delay = 0;                                      // eat the sign char
        break;

    case this.zeroSuppress == 1:                // sign != 2, zero suppress
        this.eowAction = 1;
        this.suppressLZ = (char == 0x80 ? 1 : 0);
        this.printChar(0x00);                           // print " "
        break;

    case (char & 0x01) == 1:                    // sign odd, no zero suppress
        this.eowAction = 1;
        this.suppressLZ = 0;
        this.printChar(0x20);                           // print "-"
        break;

    default:                                    // sign even, no zero suppress
        this.eowAction = 1;
        this.suppressLZ = 0;
        this.printChar(0x00);                           // print " "
        break;
    } // switch

    if (this.nextCharTime <= stamp) {
        this.nextCharTime = stamp;
    }

    setCallback(this.mnemonic, this, this.nextCharTime-stamp+delay, successor, this.boundReceiveChar);
    this.nextCharTime += delay;
};

/**************************************/
B220ConsolePrinter.prototype.receiveChar = function receiveChar(char, successor) {
    /* Receives a non-sign character from the processor and outputs it. Special handling
    is provided for tabs, carriage returns, form feeds, and end-of-word characters */
    var delay = B220ConsolePrinter.charPeriod;  // default character delay
    var nextReceiver = this.boundReceiveChar;   // default routine to receive next char
    var stamp = performance.now();              // current time

    switch (char) {
    case 0x80:                          // zero
        this.printChar(this.suppressLZ ? 0x00 : char);
        break;

    case 0x02:                          // blank (non-print)
        break;

    case 0x15:                          // form-feed
        delay *= 4;
        this.suppressLZ = 0;
        this.printFormFeed();
        break;

    case 0x16:                          // carriage-return
        delay *= 2;
        this.suppressLZ = 0;
        this.emptyLine();
        break;

    case 0x26:                          // tab
        this.suppressLZ = 0;
        this.printTab();
        break;

    case 0x35:                          // end-of-word
        nextReceiver = this.boundReceiveSign;   // next will be start of a new word
        if (this.eowAction) {
            switch (this.format) {
            case 0:                             // EOW = space
                this.printChar(0x00);
                break;
            case 1:                             // EOW = tab
                this.printTab();
                break;
            case 2:                             // EOW = carriage-return
                delay *= 2;
                this.emptyLine();
                break;
            }
        }
        break;

    default:                            // all others
        this.suppressLZ = 0;
        this.printChar(char);
        break;
    } // switch char

    setCallback(this.mnemonic, this, this.nextCharTime-stamp+delay, successor, nextReceiver);
    this.nextCharTime += delay;
};

/**************************************/
B220ConsolePrinter.prototype.shutDown = function shutDown() {
    /* Shuts down the device */

    if (this.outTimer) {
        clearCallback(this.outTimer);
    }

    if (this.window) {
        this.window.removeEventListener("beforeunload", B220ConsolePrinter.prototype.beforeUnload);
        this.window.close();
        this.window = null;
    }
};
