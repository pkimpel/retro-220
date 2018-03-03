/***********************************************************************
* retro-220/webUI B220ConsoleKeyboard.js
************************************************************************
* Copyright (c) 2017, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* Burroughs 220 Console Keyboard object.
************************************************************************
* 2017-03-08  P.Kimpel
*   Original version, from retro-205 webUI/D205ControlConsole.html.
***********************************************************************/
"use strict";

/**************************************/
function B220ConsoleKeyboard(p) {
    /* Constructor for the ConsoleKeyboard object */

    this.mnemonic = "ConsoleKeyboard";
    this.config = p.config;             // System Configuration object
    this.p = p;                         // B220Processor object
    this.doc = null;                    // window document object
    this.window = null;                 // window object, null if not displayed
    this.enabled = false;               // true if keyboard is active

    this.boundKeypress = B220ConsoleKeyboard.prototype.keypress.bind(this);
    this.boundButton_Click = B220ConsoleKeyboard.prototype.button_Click.bind(this);
    this.boundKeyboard_Unload = B220ConsoleKeyboard.prototype.keyboardUnload.bind(this);

    this.clear();
}

/**************************************/
B220ConsoleKeyboard.clickPeriod = 150;  // period for button click animation, ms

/**************************************/
B220ConsoleKeyboard.prototype.$$ = function $$(e) {
    return this.doc.getElementById(e);
};

/**************************************/
B220ConsoleKeyboard.prototype.clear = function clear() {
    /* Initializes (and if necessary, creates) the panel state */

    this.keyboardEnable(0);
};

/**************************************/
B220ConsoleKeyboard.prototype.keyboardEnable = function keyboardEnable(enable) {
    /* Enables or disables the keyboard, and if necessary, opens the window for it */

    if (enable) {
        if (this.enabled) {
            this.window.focus();
        } else {
            this.enabled = true;
            if (!this.window) {
                this.keyboardOpen();        // lamp will be lit in OnLoad()
            } else {
                this.enabledLamp.set(1);
                this.window.focus();
            }
        }
    } else {
        if (this.enabled) {
            this.enabled = false;
            this.enabledLamp.set(0);
        }
    }
};

/**************************************/
B220ConsoleKeyboard.prototype.animateClick = function animateClick(btn) {
    /* Animates the click action of a keyboard button */

    btn.classList.add("keyboardBtnDown");
    setCallback(null, btn, B220ConsoleKeyboard.clickPeriod, function unclick() {
        this.classList.remove("keyboardBtnDown");
    });
};

/**************************************/
B220ConsoleKeyboard.prototype.button_Click = function button_Click(ev) {
    /* Handler for button clicks */
    var d;                              // decimal digit keyed
    var id = ev.target.id;              // ID of the clicked element
    var p = this.p;                     // local copy of processor object

    if (ev.target.tagName == "BUTTON") {
        this.animateClick(ev.target);
    }

    if (this.enabled) {
        switch (id) {
        case "AddBtn":
            this.keyboardEnable(0);
            p.keyboardAction(-1);
            break;
        case "CBtn":
            p.keyboardAction(-2);
            break;
        case "EBtn":
            p.keyboardAction(-3);
            break;
        case "ExamBtn":
            p.keyboardAction(-4);
            break;
        case "EntBtn":
            p.keyboardAction(-5);
            break;
        case "StepBtn":
            p.keyboardAction(-6);
            break;
        default:
            if (id.length == 4 && id.substring(0, 3) == "Btn") {
                d = parseInt(id.charAt(3), 10);
                if (!isNaN(d)) {
                    p.keyboardAction(d);
                }
            }
            break;
        } // switch ev.target.it
    }
    ev.preventDefault();
    ev.stopPropagation();
    return false;
};

/**************************************/
B220ConsoleKeyboard.prototype.keypress = function keypress(ev) {
    /* Handles keyboard character events. Depending on whether there is an
    outstanding request for a keypress, returns a digit or finish pulse to the
    Processor, or discards the event altogether. Note that we have to do a little
    dance with the reference to the callback function, as the next digit can be
    solicited by the processor before the callback returns to this code, so the
    callback reference must be nullified before the call */
    var c = ev.charCode;

    if (this.enabled) {
        switch (c) {
        case 0x30: case 0x31: case 0x32: case 0x33: case 0x34:
        case 0x35: case 0x36: case 0x37: case 0x38: case 0x39:
            this.animateClick(this.$$("Btn" + (c-0x30)));
            this.p.keyboardAction(c-0x30);
            break;
        case 0x2B:                      // "+" = ADD
            this.animateClick(this.$$("AddBtn"));
            this.p.keyboardAction(-1);
            break;
        case 0x43: case 0x63:           // "C", "c"
            this.animateClick(this.$$("CBtn"));
            this.p.keyboardAction(-2);
            break;
        case 0x45: case 0x65:           // "E", "e"
            this.animateClick(this.$$("EBtn"));
            this.p.keyboardAction(-3);
            break;
        case 0x58: case 0x78:           // "X", "x"
            this.animateClick(this.$$("ExamBtn"));
            this.p.keyboardAction(-4);
            break;
        case 0x0D:                      // Enter key = ENT
            this.animateClick(this.$$("EntBtn"));
            this.p.keyboardAction(-5);
            break;
        case 0x53: case 0x73:           // "S", "s"
            this.animateClick(this.$$("StepBtn"));
            this.p.keyboardAction(-6);
            break;
        case 0:                         // Firefox reports only graphic charCodes for keypress
            if (ev.keyCode == 0x0D) {   // check keyCode instead
                this.animateClick(this.$$("EntBtn"));
                this.p.keyboardAction(-5);
            }
            break;
        } // switch c

        ev.preventDefault();
        ev.stopPropagation();
    }
};

/**************************************/
B220ConsoleKeyboard.prototype.keyboardOpen = function keyboardOpen() {
    /* Opens the keyboard window and sets up the onLoad event */
    var h = 264;
    var w = 240;

    if (!this.window) {
        B220Util.openPopup(window, "../webUI/B220ConsoleKeyboard.html", this.mnemonic,
                "resizable,width=" + w + ",height=" + h +
                    ",left=" + (screen.availWidth - w) + ",top=" + (screen.availHeight - h),
                this, B220ConsoleKeyboard.prototype.keyboardOnLoad);
    }
};

/**************************************/
B220ConsoleKeyboard.prototype.keyboardUnload = function keyboardUnload(ev) {
    /* Handles manual closing of the keyboard window */

    this.enabled = false;
    this.window.removeEventListener("keypress", this.boundKeypress);
    this.window.removeEventListener("click", this.boundButton_Click);
    this.window.removeEventListener("unload", this.boundkeyboard_Unload);
    this.window = this.doc = null;
};

/**************************************/
B220ConsoleKeyboard.prototype.keyboardOnLoad = function keyboardOnLoad(ev) {
    /* Initializes the Control Console window and user interface */
    var body;
    var de;

    this.doc = ev.target;
    this.window = this.doc.defaultView;
    body = this.$$("KeyboardCase");
    de = this.doc.documentElement;

    // Colored Lamps

    this.enabledLamp = new ColoredLamp(body, null, null, "EnabledLamp", "redLamp", "redLit");

    // Events

    this.window.addEventListener("keypress", this.boundKeypress);
    this.window.addEventListener("click", this.boundButton_Click);
    this.window.addEventListener("unload", this.boundKeyboard_Unload);

    if (this.enabled) {
        this.enabledLamp.set(1);
        this.window.focus();
    }

    this.window.resizeBy(de.scrollWidth - this.window.innerWidth, // + 4 kludge for right-padding/margin
                         de.scrollHeight - this.window.innerHeight);

    // Kludge for Chrome window.outerWidth/Height timing bug
    setCallback(null, this, 100, function chromeBug() {
        this.window.moveTo(screen.availWidth - this.window.outerWidth,
                           screen.availHeight - this.window.outerHeight);
    });
};

/**************************************/
B220ConsoleKeyboard.prototype.shutDown = function shutDown() {
    /* Shuts down the panel */

    if (this.window) {
        this.window.close();
    }
};