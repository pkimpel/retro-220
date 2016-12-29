/***********************************************************************
* retro-220/webUI B220ControlConsole.js
************************************************************************
* Copyright (c) 2017, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* Burroughs 220 Emulator Control Console object.
************************************************************************
* 2017-01-01  P.Kimpel
*   Original version, from D205SupervisoryPanel.js.
***********************************************************************/
"use strict";

/**************************************/
function B220ControlConsole(p, systemShutdown) {
    /* Constructor for the ControlConsole object */
    var h = 584;
    var w = 1064;
    var mnemonic = "ControlConsole";

    this.config = p.config;             // System Configuration object
    this.intervalToken = 0;             // setInterval() token for panel refresh
    this.timerBase = performance.now(); // starting value of Interval Timer
    this.timerValue = 0;                // current value of Interval Timer
    this.p = p;                         // B220Processor object
    this.systemShutdown = systemShutdown; // system shut-down callback

    this.boundLamp_Click = B220Util.bindMethod(this, B220ControlConsole.prototype.lamp_Click);
    this.boundPowerBtn_Click = B220Util.bindMethod(this, B220ControlConsole.prototype.powerBtn_Click);
    this.boundClear_Click = B220Util.bindMethod(this, B220ControlConsole.prototype.clear_Click);
    this.boundFlipSwitch = B220Util.bindMethod(this, B220ControlConsole.prototype.flipSwitch);
    this.boundStartBtn_Click = B220Util.bindMethod(this, B220ControlConsole.prototype.startBtn_Click);
    this.boundResetTimer = B220Util.bindMethod(this, B220ControlConsole.prototype.resetTimer);
    this.boundUpdatePanel = B220Util.bindMethod(this, B220ControlConsole.prototype.updatePanel);

    this.doc = null;
    this.window = window.open("../webUI/B220ControlConsole.html", mnemonic,
            "location=no,scrollbars,resizable,width=" + w + ",height=" + h +
            ",top=0,left=" + (screen.availWidth - w));
    this.window.addEventListener("load",
        B220Util.bindMethod(this, B220ControlConsole.prototype.consoleOnLoad));
}

/**************************************/
B220ControlConsole.displayRefreshPeriod = 50;   // milliseconds
B220ControlConsole.offSwitchClass = "./resources/ToggleDown.png";
B220ControlConsole.onSwitchClass = "./resources/ToggleUp.png";

/**************************************/
B220ControlConsole.prototype.$$ = function $$(e) {
    return this.doc.getElementById(e);
};

/**************************************/
B220ControlConsole.prototype.powerOnSystem = function powerOnSystem() {
    /* Powers on the system */

    if (!this.p.poweredOn) {
        this.p.powerUp();
        this.powerLamp.set(1);
        this.window.focus();
        if (!this.intervalToken) {
            this.intervalToken = this.window.setInterval(this.boundUpdatePanel, B220ControlConsole.displayRefreshPeriod);
        }
    }
};

/**************************************/
B220ControlConsole.prototype.powerOffSystem = function powerOffSystem() {
    /* Powers off the system */

    if (this.p.poweredOn) {
        this.systemShutdown();
        this.powerLamp.set(0);
        if (this.intervalToken) {       // if the display auto-update is running
            this.window.clearInterval(this.intervalToken);  // kill it
            this.intervalToken = 0;
        }
    }
};

/**************************************/
B220ControlConsole.prototype.beforeUnload = function beforeUnload(ev) {
    var msg = "Closing this window will make the panel unusable.\n" +
              "Suggest you stay on the page and minimize this window instead";

    ev.preventDefault();
    ev.returnValue = msg;
    return msg;
};

/**************************************/
B220ControlConsole.prototype.displayCallbackState = function displayCallbackState() {
    /* Builds a table of outstanding callback state */
    var cb;
    var cbs;
    var e;
    var body = document.createElement("tbody");
    var oldBody = this.$$("CallbackBody");
    var row;
    var state = getCallbackState(0x03);
    var token;

    cbs = state.delayDev;
    for (token in cbs) {
        row = document.createElement("tr");

        e = document.createElement("td");
        e.appendChild(document.createTextNode(token));
        row.appendChild(e);

        e = document.createElement("td");
        e.appendChild(document.createTextNode((cbs[token]||0).toFixed(2)));
        row.appendChild(e);

        e = document.createElement("td");
        e.colSpan = 2;
        row.appendChild(e);
        body.appendChild(row);
    }

    cbs = state.pendingCallbacks;
    for (token in cbs) {
        cb = cbs[token];
        row = document.createElement("tr");

        e = document.createElement("td");
        e.appendChild(document.createTextNode(token.toString()));
        row.appendChild(e);

        e = document.createElement("td");
        e.appendChild(document.createTextNode(cb.delay.toFixed(2)));
        row.appendChild(e);

        e = document.createElement("td");
        e.appendChild(document.createTextNode((cb.context && cb.context.mnemonic) || "??"));
        row.appendChild(e);

        e = document.createElement("td");
        e.appendChild(document.createTextNode((cb.args ? cb.args.length : 0).toString()));
        row.appendChild(e);
        body.appendChild(row);
    }

    body.id = oldBody.id;
    oldBody.parentNode.replaceChild(body, oldBody);
};

/**************************************/
B220ControlConsole.prototype.updatePanel = function updatePanel() {
    /* Updates the panel from the current Processor state */
    var eLevel;
    var p = this.p;                     // local copy of Processor object
    var stamp = performance.now();
    var text;
    var tg = p.toggleGlow;

    // This needs to be done only if the Processor is in RUN status.
    this.timerValue = stamp - this.timerBase;
    text = (this.timerValue/1000 + 10000).toFixed(1);
    this.intervalTimer.textContent = text.substring(text.length-6);

    return;     /////////////////// DEBUG ///////////////////////////////////////////////////////

    eLevel = (p.stopIdle ? p.togTiming : tg.glowTiming);

    this.regA.updateGlow(tg.glowA);
    this.regB.updateGlow(tg.glowB);
    this.regC.updateGlow(tg.glowC);
    this.regD.updateGlow(tg.glowD);
    this.regR.updateGlow(tg.glowR);
    this.control.updateGlow(tg.glowCtl);

    this.regAdder.updateGlow(tg.glowADDER);
    this.regCarry.updateGlow(tg.glowCT);

    this.cardatronTWA.set(tg.glowTWA);
    this.cardatron3IO.set(tg.glow3IO);

    this.overflowLamp.set(p.poweredOn && tg.glowOverflow);
    this.sectorLamp.set(p.stopSector);
    this.fcLamp.set(p.stopForbidden);
    this.controlLamp.set(p.stopControl);
    this.idleLamp.set(p.poweredOn && p.stopIdle);

    this.executeLamp.set(p.poweredOn && (1-eLevel));
    this.fetchLamp.set(p.poweredOn && eLevel);

    this.mainLamp.set(tg.glowMAIN);
    this.rwmLamp.set(tg.glowRWM);
    this.rwlLamp.set(tg.glowRWL);
    this.wdblLamp.set(tg.glowWDBL);
    this.actLamp.set(tg.glowACTION);
    this.accessLamp.set(tg.glowACCESS);
    this.lmLamp.set(tg.glowLM);
    this.l4Lamp.set(tg.glowL4);
    this.l5Lamp.set(tg.glowL5);
    this.l6Lamp.set(tg.glowL6);
    this.l7Lamp.set(tg.glowL7);

    /********** DEBUG **********
    this.$$("ProcDelta").value = p.procSlackAvg.toFixed(2);
    this.$$("LastLatency").value = p.delayDeltaAvg.toFixed(2);
    this.displayCallbackState();
    ***************************/
};

/**************************************/
B220ControlConsole.prototype.lamp_Click = function lamp_Click(ev) {
    /* Handles the click event within panels. Determines which lamp element was
    clicked, flips the state of the corresponding toggle in the Processor, and
    refreshes the lamp element */
    var bit;                            // bit number extracted from the id
    var id = ev.target.id;              // id of the element clicked
    var ix = id.indexOf("_");           // offset of the "_" delimiter in the id
    var p = this.p;                     // local copy of processor object
    var reg;                            // register prefix from id

    if (p.poweredOn) {
        if (ix < 0) {
            reg = id;
            bit = 0;
        } else if (ix > 0) {
            reg = id.substring(0, ix);
            bit = parseInt(id.substring(ix+1));
            if (isNaN(bit)) {
                bit = 0;
            }
        }

        switch (reg) {
        case "A":
            p.A = p.bitFlip(p.A, bit);
            this.regA.update(p.A);
            break;
        case "B":
            p.B = p.bitFlip(p.B, bit);
            this.regB.update(p.B);
            break;
        case "C":
            p.C = p.bitFlip(p.C, bit);
            this.regC.update(p.C);
            break;
        case "D":
            p.D = p.bitFlip(p.D, bit);
            this.regD.update(p.D);
            break;
        case "R":
            p.R = p.bitFlip(p.R, bit);
            this.regR.update(p.R);
            break;
        case "ADD":
            p.ADDER = p.bitFlip(p.ADDER, bit);
            this.regAdder.update(p.ADDER);
            break;
        case "CT":
            p.CT = p.bitFlip(p.CT, bit);
            this.regCarry.update(p.CT);
            break;
        case "TWA":
            p.togTWA ^= 1;
            this.cardatronTWA.set(p.togTWA);
            break;
        case "3IO":
            p.tog3IO ^= 1;
            this.cardatron3IO.set(p.tog3IO);
            break;
        case "CTL":
            switch (bit) {
            case 0:
            case 1:
            case 2:
            case 3:
            case 4:
                p.SHIFT = p.bitFlip(p.SHIFT, bit);
                break;
            case 5:
                p.togMT1BV5 ^= 1;
                break;
            case 6:
                p.togMT1BV4 ^= 1;
                break;
            case 7:
                p.togMT3P ^= 1;
                break;
            case 8:
            case 9:
            case 10:
            case 11:
                p.SHIFTCONTROL = p.bitFlip(p.SHIFTCONTROL, bit-8);
                break;
            case 12:
                p.togASYNC ^= 1;
                break;
            case 13:
                p.togZCT ^= 1;
                break;
            case 14:
                p.togBKPT ^= 1;
                break;
            case 15:
                p.togT0 ^= 1;
                break;
            case 16:
                p.togDELAY ^= 1;
                break;
            case 17:
                p.togPO2 ^= 1;
                break;
            case 18:
                p.togPO1 ^= 1;
                break;
            case 19:
                p.togOK ^= 1;
                break;
            case 20:
                p.togTC2 ^= 1;
                break;
            case 21:
                p.togTC1 ^= 1;
                break;
            case 22:
                p.togTF ^= 1;
                break;
            case 23:
                p.togSTART ^= 1;
                break;
            case 24:
                p.togSTEP ^= 1;
                break;
            case 25:
                p.togDIVALARM ^= 1;
                break;
            case 26:
                p.togCOUNT ^= 1;
                break;
            case 27:
                p.togSIGN ^= 1;
                break;
            case 28:
                p.togMULDIV ^= 1;
                break;
            case 29:
                p.togCLEAR ^= 1;
                break;
            case 30:
                p.togPLUSAB ^= 1;
                break;
            case 31:
                p.togCOMPL ^= 1;
                break;
            case 32:
                p.togDELTABDIV ^= 1;
                break;
            case 33:
                p.togDPCTR ^= 1;
                break;
            case 34:
                p.togADDER ^= 1;
                break;
            case 35:
                p.togBTOAIN ^= 1;
                break;
            case 36:
            case 37:
            case 38:
            case 39:
                p.SPECIAL = p.bitFlip(p.SPECIAL, bit-36);
                break;
            } // switch bit

            break;
        } // switch reg
    }

    ev.preventDefault();
    ev.stopPropagation();
    return false;
};

/**************************************/
B220ControlConsole.prototype.clear_Click = function Clear_Click(ev) {
    /* Event handler for the various clear/reset buttons on the panel */

    if (this.p.poweredOn) {
        switch (ev.target.id) {
        case "ClearBtn":
            this.p.clear();
            break;
        case "ClearARegBtn":
            this.p.A = 0;
            break;
        case "ClearBRegBtn":
            this.p.B = 0;
            break;
        case "ClearCRegBtn":
            this.p.C = 0;
            break;
        case "ClearDRegBtn":
            this.p.D = 0;
            break;
        case "ClearRRegBtn":
            this.p.R = 0;
            break;
        case "ClearControlBtn":
            this.p.clearControl();
            break;
        case "ResetOverflowBtn":
            this.p.setOverflow(0);
            break;
        case "ResetSectorBtn":
            this.p.stopSector = 0;
            break;
        case "ResetControlBtn":
            this.p.stopControl = 0;
            break;
        case "ExecuteBtn":
            this.p.setTimingToggle(0);
            break;
        case "FetchBtn":
            this.p.setTimingToggle(1 - this.p.sswLockNormal);
            break;
        }
        this.updatePanel();
    }
    ev.preventDefault();
    return false;
};

/**************************************/
B220ControlConsole.prototype.powerBtn_Click = function powerBtn_Click(ev) {
    /* Handler for the START button: begins execution for the current cycle */

    switch(ev.target.id) {
    case "PowerOnBtn":
        this.powerOnSystem();
        break;
    case "PowerOffBtn":
        this.powerOffSystem();
        break;
    }
    this.updatePanel();
    ev.preventDefault();
    return false;
};

/**************************************/
B220ControlConsole.prototype.startBtn_Click = function startBtn_Click(ev) {
    /* Handler for the START button: begins execution for the current cycle */

    this.p.start();
    this.timerBase = performance.now() - this.timerValue;
    this.updatePanel();
    ev.preventDefault();
    return false;
};

/**************************************/
B220ControlConsole.prototype.resetTimer = function resetTimer(ev) {
    /* Resets the Interval Timer display to 0000.0 */

    this.timerBase = performance.now();
    this.timerValue = 0;
};

/**************************************/
B220ControlConsole.prototype.flipSwitch = function flipSwitch(ev) {
    /* Handler for switch & knob clicks */

    switch (ev.target.id) {
    case "AudibleAlarmSwitch":
        this.audibleAlarmSwitch.flip();
        this.config.putNode("ControlConsole.audibleAlarmSwitch",
                this.p.sswAudibleAlarm = this.audibleAlarmSwitch.state);
        break;
    case "LockNormalSwitch":
        this.lockNormalSwitch.flip();
        this.config.putNode("ControlConsole.lockNormalSwitch",
                this.p.sswLockNormal = this.lockNormalSwitch.state);
        break;
    case "StepContinuousSwitch":
        this.stepContinuousSwitch.flip();
        this.config.putNode("ControlConsole.stepContinuousSwitch",
                this.p.sswStepContinuous = this.stepContinuousSwitch.state);
        break;
    case "PulseSourceSwitch":           // non-functional, just turn it back off
        this.pulseSourceSwitch.flip();
        this.config.putNode("ControlConsole.pulseSourceSwitch", 0);
        setCallback(null, this.pulseSourceSwitch, 250, this.pulseSourceSwitch.set, 0);
        break;
    case "WordContSwitch":              // non-functional, just turn it back off
        this.wordContSwitch.flip();
        this.config.putNode("ControlConsole.wordContSwitch", 0);
        setCallback(null, this.wordContSwitch, 250, this.wordContSwitch.set, 0);
        break;
    case "FrequencyKnob":               // non-function knob -- just step it
        this.frequencyKnob.step();
        this.config.putNode("ControlConsole.frequencyKnob", this.frequencyKnob.position);
        break;
    }

    this.updatePanel();
    ev.preventDefault();
    return false;
};

/**************************************/
B220ControlConsole.prototype.consoleOnLoad = function consoleOnLoad() {
    /* Initializes the Supervisory Panel window and user interface */
    var body;
    var prefs = this.config.getNode("ControlConsole");
    var x;

    this.doc = this.window.document;
    body = this.$$("PanelSurface");

    this.intervalTimer = this.$$("IntervalTimer");

    // Main Registers

    this.regA = new PanelRegister(this.$$("ARegPanel"), 44, 4, "A_", "A");
    this.regB = new PanelRegister(this.$$("BRegPanel"), 16, 4, "B_", "B");
    this.regC = new PanelRegister(this.$$("CRegPanel"), 40, 4, "C_", "C");
    this.regD = new PanelRegister(this.$$("DRegPanel"), 44, 4, "D_", "D");
    this.regE = new PanelRegister(this.$$("ERegPanel"), 16, 4, "E_", "E");
    this.regR = new PanelRegister(this.$$("RRegPanel"), 44, 4, "R_", "R");
    this.regP = new PanelRegister(this.$$("PRegPanel"), 16, 4, "P_", "P");
    this.regS = new PanelRegister(this.$$("SRegPanel"), 16, 4, "S_", "S");

    // Status Panels

    this.digitCheckLamp = new ColoredLamp(body, null, null, "DigitCheckLamp", "redLamp lampCollar", "whiteLit");
    this.powerLamp = new ColoredLamp(body, null, null, "PowerLamp", "greenLamp", "greenLit");

    this.overflowLamp = new ColoredLamp(body, null, null, "OverflowLamp", "redLamp", "redLit");

    this.sectorLamp = new ColoredLamp(body, null, null, "SectorLamp", "whiteLamp", "whiteLit");
    this.controlLamp = new ColoredLamp(body, null, null, "ControlLamp", "orangeLamp", "orangeLit");
    this.fcLamp = new ColoredLamp(body, null, null, "FCLamp", "whiteLamp", "whiteLit");
    this.idleLamp = new ColoredLamp(body, null, null, "IdleLamp", "redLamp", "redLit");

    this.executeLamp = new ColoredLamp(body, null, null, "ExecuteLamp", "whiteLamp", "whiteLit");
    this.fetchLamp = new ColoredLamp(body, null, null, "FetchLamp", "whiteLamp", "whiteLit");

    // Organ Switches

    this.audibleAlarmSwitch = new ToggleSwitch(body, null, null, "AudibleAlarmSwitch",
            B220ControlConsole.offSwitchClass, B220ControlConsole.onSwitchClass);
    this.audibleAlarmSwitch.set(this.p.sswAudibleAlarm = prefs.audibleAlarmSwitch);
    this.lockNormalSwitch = new ToggleSwitch(body, null, null, "LockNormalSwitch",
            B220ControlConsole.offSwitchClass, B220ControlConsole.onSwitchClass);
    this.lockNormalSwitch.set(this.p.sswLockNormal = prefs.lockNormalSwitch);
    this.stepContinuousSwitch = new ToggleSwitch(body, null, null, "StepContinuousSwitch",
            B220ControlConsole.offSwitchClass, B220ControlConsole.onSwitchClass);
    this.stepContinuousSwitch.set(this.p.sswStepContinuous = prefs.stepContinuousSwitch);

    // Events
    this.$$("IntervalTimerResetBtn").addEventListener("click", this.boundResetTimer);
    /*****
    this.$$("ResetOverflowBtn").addEventListener("click", this.boundClear_Click);
    this.$$("ResetSectorBtn").addEventListener("click", this.boundClear_Click);
    this.$$("ResetControlBtn").addEventListener("click", this.boundClear_Click);
    this.$$("ExecuteBtn").addEventListener("click", this.boundClear_Click);
    this.$$("FetchBtn").addEventListener("click", this.boundClear_Click);
    this.$$("PowerOnBtn").addEventListener("click", this.boundPowerBtn_Click);
    *****/
    this.$$("PowerOffBtn").addEventListener("click", this.boundPowerBtn_Click);

    this.window.addEventListener("beforeunload", B220ControlConsole.prototype.beforeUnload);

    /*****
    this.$$("AudibleAlarmSwitch").addEventListener("click", this.boundFlipSwitch);
    this.$$("LockNormalSwitch").addEventListener("click", this.boundFlipSwitch);
    this.$$("StepContinuousSwitch").addEventListener("click", this.boundFlipSwitch);

    this.$$("StartBtn").addEventListener("click", this.boundStartBtn_Click);

    this.$$("ARegPanel").addEventListener("click", this.boundLamp_Click);
    this.$$("BRegPanel").addEventListener("click", this.boundLamp_Click);
    this.$$("CRegPanel").addEventListener("click", this.boundLamp_Click);
    this.$$("DRegPanel").addEventListener("click", this.boundLamp_Click);
    this.$$("RRegPanel").addEventListener("click", this.boundLamp_Click);
    *****/

    this.$$("EmulatorVersion").textContent = B220Processor.version;

    // Power on the system by default...
    setCallback(this.mnemonic, this, 1000, function powerOnTimer() {
        this.powerOnSystem();
    });
};

/**************************************/
B220ControlConsole.prototype.shutDown = function shutDown() {
    /* Shuts down the panel */

    if (this.intervalToken) {
        this.window.clearInterval(this.intervalToken);
    }
    this.window.removeEventListener("beforeunload", B220ControlConsole.prototype.beforeUnload);
    this.window.close();
};