/***********************************************************************
* retro-220/webUI B220CardatronControl.js
************************************************************************
* Copyright (c) 2017, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* Burroughs 220 Cardatron Control object.
************************************************************************
* 2017-05-19  P.Kimpel
*   Original version, from retro-205 D205CardatronControl.js.
***********************************************************************/
"use strict";

/**************************************/
function B220CardatronControl(p) {
    /* Constructor for the CardatronControl object */
    var left = 660;                     // left window margin
    var u;                              // unit config object
    var x;                              // unit index

    this.config = p.config;             // System configuration object
    this.mnemonic = "CCU";
    this.p = p;                         // B220Processor object

    // Do not call this.clear() here -- call from onLoad instead

    this.doc = null;
    this.window = window.open("../webUI/B220CardatronControl.html", this.mnemonic,
            "location=no,scrollbars=no,resizable,width=140,height=140,top=0,left=" + left);
    this.window.addEventListener("load",
        B220Util.bindMethod(this, B220CardatronControl.prototype.cardatronOnLoad));

    // Set up the I/O devices from the system configuration
    this.inputUnit = [
            null,                       // no input unit 0
            null,                       // input unit 1
            null,                       // input unit 2
            null,                       // input unit 3
            null,                       // input unit 4
            null,                       // input unit 5
            null,                       // input unit 6
            null];                      // input unit 7
    this.outputUnit = [
            null,                       // no output unit 0
            null,                       // output unit 1
            null,                       // output unit 2
            null,                       // output unit 3
            null,                       // output unit 4
            null,                       // output unit 5
            null,                       // output unit 6
            null];                      // output unit 7

    for (x=7; x>0; --x) {
        u = this.config.getNode("Cardatron.units", x);
        switch (u.type.substring(0, 2)) {
        case "CR":
            this.inputUnit[x] = new B220CardatronInput(u.type, x, this.config);
            this.outputUnit[8-x] = null;
            break;
        case "CP":
        case "LP":
            this.inputUnit[x] = null;
            this.outputUnit[8-x] = new B220CardatronOutput(u.type, x, this.config);
            break;
        default:
            this.inputUnit[x] = null;
            this.outputUnit[8-x] = null;
            break;
        } // switch u.type
    } // for x
}

/**************************************/
B220CardatronControl.prototype.$$ = function $$(e) {
    return this.doc.getElementById(e);
};

/**************************************/
B220CardatronControl.prototype.clear = function clear() {
    /* Initializes the panel state */

    this.bufferReadLamp.set(0);
    this.bufferWriteLamp.set(0);
    this.formatLoadLamp.set(0);
    this.outputUnitLamp.set(0);
    this.setUnitDesignateLamps(0);
    this.setRelayDesignateLamps(0);
};

/**************************************/
B220CardatronControl.prototype.setUnitDesignateLamps = function setUnitDesignateLamps(unit) {
    /* Sets the UD lamps on the panel from the low-order three bits of "unit" */

    this.unitDesignate1Lamp.set(unit & 0x01);
    this.unitDesignate2Lamp.set((unit >>> 1) & 0x01);
    this.unitDesignate4Lamp.set((unit >>> 2) & 0x01);
};

/**************************************/
B220CardatronControl.prototype.setRelayDesignateLamps = function setRelayDesignateLamps(mask) {
    /* Sets the RD lamps on the panel from the low-order four bits of "mask" */

    this.relayDesignate1Lamp.set(mask & 0x01);
    this.relayDesignate2Lamp.set((mask >>> 1) & 0x01);
    this.relayDesignate4Lamp.set((mask >>> 2) & 0x01);
    this.relayDesignate8Lamp.set((mask >>> 3) & 0x01);
};

/**************************************/
B220CardatronControl.prototype.ClearBtn_onClick = function ClearBtn_onClick(ev) {
    /* Handle the click event for the CLEAR button, which will clear the
    Cardatron Control state */

    this.clear();
};

/**************************************/
B220CardatronControl.prototype.beforeUnload = function beforeUnload(ev) {
    var msg = "Closing this window will make the panel unusable.\n" +
              "Suggest you stay on the page and minimize this window instead";

    ev.preventDefault();
    ev.returnValue = msg;
    return msg;
};

/**************************************/
B220CardatronControl.prototype.cardatronOnLoad = function cardatronOnLoad() {
    /* Initializes the Cardatron Control window and user interface */
    var body;
    var box;
    var e;
    var x;

    this.doc = this.window.document;
    body = this.$$("PanelSurface");

    this.bufferReadLamp = new NeonLampBox(body, null, null, "BufferReadLamp");
    this.bufferReadLamp.setCaption("BR", true);
    this.bufferWriteLamp = new NeonLampBox(body, null, null, "BufferWriteLamp");
    this.bufferWriteLamp.setCaption("BW", true);
    this.formatLoadLamp = new NeonLampBox(body, null, null, "FormatLoadLamp");
    this.formatLoadLamp.setCaption("FL", true);
    this.outputUnitLamp = new NeonLampBox(body, null, null, "OutputUnitLamp");
    this.outputUnitLamp.setCaption("OU", true);

    this.unitDesignate4Lamp = new NeonLampBox(body, null, null, "UnitDesignate4Lamp");
    this.unitDesignate4Lamp.setCaption("UD4", true);
    this.unitDesignate2Lamp = new NeonLampBox(body, null, null, "UnitDesignate2Lamp");
    this.unitDesignate2Lamp.setCaption("UD2", true);
    this.unitDesignate1Lamp = new NeonLampBox(body, null, null, "UnitDesignate1Lamp");
    this.unitDesignate1Lamp.setCaption("UD1", true);

    this.relayDesignate8Lamp = new NeonLampBox(body, null, null, "RelayDesignate8Lamp");
    this.relayDesignate8Lamp.setCaption("RD8", true);
    this.relayDesignate4Lamp = new NeonLampBox(body, null, null, "RelayDesignate4Lamp");
    this.relayDesignate4Lamp.setCaption("RD4", true);
    this.relayDesignate2Lamp = new NeonLampBox(body, null, null, "RelayDesignate2Lamp");
    this.relayDesignate2Lamp.setCaption("RD2", true);
    this.relayDesignate1Lamp = new NeonLampBox(body, null, null, "RelayDesignate1Lamp");
    this.relayDesignate1Lamp.setCaption("RD1", true);

    // Events

    this.window.addEventListener("beforeunload", B220CardatronControl.prototype.beforeUnload);
    this.$$("ClearBtn").addEventListener("click",
            B220Util.bindMethod(this, B220CardatronControl.prototype.ClearBtn_onClick));

    this.clear();
};

/**************************************/
B220CardatronControl.prototype.inputInitiate = function inputInitiate(unitNr, rDigit, wordSender) {
    /* Initiates the read from one of the Cardatron input devices.
    Returns 0 if device exists and the I/O was initiated; returns -1 if device
    not present */

    this.bufferReadLamp.set(1);
    this.bufferWriteLamp.set(0);
    this.formatLoadLamp.set(0);
    this.outputUnitLamp.set(0);
    this.setRelayDesignateLamps(0);
    this.setUnitDesignateLamps(unitNr);
    if (!this.inputUnit[unitNr]) {
        return -1;                      // just terminate the I/O
    } else {
        this.inputUnit[unitNr].inputInitiate(rDigit, wordSender);
        return 0;
    }
};

/**************************************/
B220CardatronControl.prototype.inputReadyInterrogate = function inputReadyInterrogate(unitNr) {
    /* Interrogates the ready status of a Cardatron input device.
    Returns -1 if device not present, 0 if device not ready, 1 if device is ready */

    this.setUnitDesignateLamps(unitNr);
    if (!this.inputUnit[unitNr]) {
        return -1;
    } else {
        return (this.inputUnit[unitNr].inputReadyInterrogate() ? 1 : 0);
    }
};

/**************************************/
B220CardatronControl.prototype.inputFormatInitiate = function inputFormatInitiate(
        unitNr, rDigit, requestNextWord, signalFinished) {
    /* Initiates loading a format band for one of the Cardatron input devices.
    Returns 0 if device exists and the I/O was initiated; returns -1 if device
    not present */

    this.bufferReadLamp.set(0);
    this.bufferWriteLamp.set(0);
    this.formatLoadLamp.set(1);
    this.outputUnitLamp.set(0);
    this.setRelayDesignateLamps(0);
    this.setUnitDesignateLamps(unitNr);
    if (!this.inputUnit[unitNr]) {
        return -1;                      // just terminate the I/O
    } else {
        this.inputUnit[unitNr].inputFormatInitiate(rDigit, requestNextWord, signalFinished);
        return 0;
    }
};

/**************************************/
B220CardatronControl.prototype.outputInitiate = function outputInitiate(
        unitNr, fDigit, cDigit, requestNextWord, signalFinished) {
    /* Initiates writing to one of the Cardatron output devices.
    Returns 0 if device exists and the I/O was initiated; returns -1 if device
    not present */

    this.bufferReadLamp.set(0);
    this.bufferWriteLamp.set(1);
    this.formatLoadLamp.set(0);
    this.outputUnitLamp.set(1);
    this.setRelayDesignateLamps(cDigit);
    this.setUnitDesignateLamps(unitNr);
    if (!this.outputUnit[unitNr]) {
        return -1;                      // just terminate the I/O
    } else {
        this.outputUnit[unitNr].outputInitiate(fDigit, cDigit, requestNextWord, signalFinished);
        return 0;
    }
};

/**************************************/
B220CardatronControl.prototype.outputReadyInterrogate = function outputReadyInterrogate(unitNr) {
    /* Interrogates the ready status of a Cardatron output device.
    Returns -1 if device not present, 0 if device not ready, 1 if device is ready */

    this.setUnitDesignateLamps(unitNr);
    if (!this.outputUnit[unitNr]) {
        return -1;                      // just terminate the I/O
    } else {
        return (this.outputUnit[unitNr].outputReadyInterrogate() ? 1 : 0);
    }
};

/**************************************/
B220CardatronControl.prototype.outputFormatInitiate = function outputFormatInitiate(
        unitNr, fDigit, requestNextWord, signalFinished) {
    /* Initiates loading a format band for one of the Cardatron output devices.
    Returns 0 if device exists and the I/O was initiated; returns -1 if device
    not present */

    this.bufferReadLamp.set(0);
    this.bufferWriteLamp.set(0);
    this.formatLoadLamp.set(1);
    this.outputUnitLamp.set(1);
    this.setRelayDesignateLamps(0);
    this.setUnitDesignateLamps(unitNr);
    if (!this.outputUnit[unitNr]) {
        return -1;                      // just terminate the I/O
    } else {
        this.outputUnit[unitNr].outputFormatInitiate(fDigit, requestNextWord, signalFinished);
        return 0;
    }
};

/**************************************/
B220CardatronControl.prototype.shutDown = function shutDown() {
    /* Shuts down the panel */
    var x;

    if (this.inputUnit) {
        for (x=this.inputUnit.length-1; x>=0; --x) {
            if (this.inputUnit[x]) {
                this.inputUnit[x].shutDown();
                this.inputUnit[x] = null;
            }
        }
    }

    if (this.outputUnit) {
        for (x=this.outputUnit.length-1; x>=0; --x) {
            if (this.outputUnit[x]) {
                this.outputUnit[x].shutDown();
                this.outputUnit[x] = null;
            }
        }
    }

    this.window.removeEventListener("beforeunload", B220CardatronControl.prototype.beforeUnload);
    this.window.close();
};