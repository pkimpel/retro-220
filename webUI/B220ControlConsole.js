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
    var h = 600;
    var w = 1064;
    var mnemonic = "ControlConsole";
    var outputConfig = p.config.getNode("ConsoleOutput");
    var u;
    var x;

    this.config = p.config;             // System Configuration object
    this.intervalToken = 0;             // setInterval() token for panel refresh
    this.p = p;                         // B220Processor object
    this.systemShutdown = systemShutdown; // system shut-down callback

    this.keyboard = new B220ConsoleKeyboard(p);

    this.boundLamp_Click = B220Util.bindMethod(this, B220ControlConsole.prototype.lamp_Click);
    this.boundPowerBtn_Click = B220Util.bindMethod(this, B220ControlConsole.prototype.powerBtn_Click);
    this.boundSwitch_Click = B220Util.bindMethod(this, B220ControlConsole.prototype.switch_Click);
    this.boundStartBtn_Click = B220Util.bindMethod(this, B220ControlConsole.prototype.startBtn_Click);
    this.boundResetTimer = B220Util.bindMethod(this, B220ControlConsole.prototype.resetTimer);
    this.boundUpdatePanel = B220Util.bindMethod(this, B220ControlConsole.prototype.updatePanel);

    // Configure the console output unit objects. These can be any combination
    // of paper tape punches and teletype printers.
    this.outputUnit = [
            null,                       // 0=unit A (usually the SPO)
            null,                       // 1=unit B
            null,                       // 2=unit C
            null,                       // 3=unit D
            null,                       // 4=unit E
            null,                       // 5=unit F
            null,                       // 6=unit G
            null,                       // 7=unit H
            null,                       // 8=unit I
            null,                       // 9=unit J
            null];                      //10=unit K

    for (x=0; x<outputConfig.units.length; ++x) {
        u = outputConfig.units[x];
        switch (u.type.substring(0, 3)) {
        case "TTY":
            this.outputUnit[x] = new B220ConsolePrinter(u.type, x, this.config);
            break;
        case "PTP":
            this.outputUnit[x] = new B220PaperTapePunch(u.type, x, this.config);
            break;
        default:
            this.outputUnit[x] = null;
            break;
        } // switch u.type
    }

    // Create the Console window
    this.doc = null;
    this.window = window.open("../webUI/B220ControlConsole.html", mnemonic,
            "location=no,scrollbars,resizable,width=" + w + ",height=" + h +
            ",top=0,left=" + (screen.availWidth - w));
    this.window.addEventListener("load",
        B220Util.bindMethod(this, B220ControlConsole.prototype.consoleOnLoad));
}

/**************************************/
B220ControlConsole.displayRefreshPeriod = 50;   // milliseconds
B220ControlConsole.offSwitchImage = "./resources/ToggleDown.png";
B220ControlConsole.onSwitchImage = "./resources/ToggleUp.png";
B220ControlConsole.offOrganSwitchImage = "./resources/Organ-Switch-Up.png"
B220ControlConsole.onOrganSwitchImage = "./resources/Organ-Switch-Down.png"

/**************************************/
B220ControlConsole.prototype.$$ = function $$(e) {
    return this.doc.getElementById(e);
};

/**************************************/
B220ControlConsole.prototype.powerOnSystem = function powerOnSystem() {
    /* Powers on the system */

    if (!this.p.poweredOn) {
        this.p.powerUp();
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
    var eLevel;                         // EXECUTE lamp glow level
    var p = this.p;                     // local copy of Processor object
    var stamp = performance.now();
    var text;                           // run timer display text
    var timer = p.runTimer;

    // Update the interval timer
    while (timer < 0) {
        timer += stamp;
    }
    text = (timer/1000 + 10000).toFixed(1);
    this.intervalTimer.textContent = text.substring(text.length-6);

    p.updateGlow(0);
    eLevel = (p.RUT.value ? p.EXT.glow : p.EXT.value);

    // Primary Registers
    this.regA.updateGlow(p.A.glow);
    this.regB.updateGlow(p.B.glow);
    this.regC.updateGlow(p.C.glow);
    this.regD.updateGlow(p.D.glow);
    this.regE.updateGlow(p.E.glow);
    this.regP.updateGlow(p.P.glow);
    this.regR.updateGlow(p.R.glow);
    this.regS.updateGlow(p.S.glow);

    // Alarm Panel
    this.digitCheckLamp.set(p.digitCheckAlarm.glow);
    this.programCheckLamp.set(p.ALT.glow);
    this.storageLamp.set(p.MET.glow);
    this.magneticTapeLamp.set(p.TAT.glow);
    this.paperTapeLamp.set(p.PAT.glow);
    this.cardatronLamp.set(p.CRT.glow);
    this.highSpeedPrinterLamp.set(p.HAT.glow);
    this.systemNotReadyLamp.set(p.systemNotReady.glow);
    this.computerNotReadyLamp.set(p.computerNotReady.glow);

    // Operation Panel
    this.runLamp.set(p.RUT.glow);
    this.fetchLamp.set(1-eLevel);
    this.executeLamp.set(eLevel);

    // Status Panel
    this.overflowLamp.set(p.OFT.glow);
    this.repeatLamp.set(p.RPT.glow);
    this.lowLamp.set(p.compareLowLamp.glow);
    this.equalLamp.set(p.compareEqualLamp.glow);
    this.highLamp.set(p.compareHighLamp.glow);

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
            return;
        } else if (ix > 0) {
            reg = id.substring(0, ix);
            bit = parseInt(id.substring(ix+1), 10);
            if (isNaN(bit)) {
                return;
            }
        }

        switch (reg) {
        case "A":
            p.A.flipBit(bit);
            break;
        case "B":
            p.B.flipBit(bit);
            break;
        case "C":
            p.C.flipBit(bit);
            break;
        case "D":
            p.D.flipBit(bit);
            break;
        case "E":
            p.E.flipBit(bit);
            break;
        case "P":
            p.P.flipBit(bit);
            break;
        case "R":
            p.R.flipBit(bit);
            break;
        case "S":
            p.S.flipBit(bit);
            break;
        } // switch reg
    }

    ev.preventDefault();
    ev.stopPropagation();
    return false;
};

/**************************************/
B220ControlConsole.prototype.powerBtn_Click = function powerBtn_Click(ev) {
    /* Handler for the START button: begins execution for the current cycle */

    switch(ev.target.id) {
    case "PowerOffBtn":
        this.powerOffSystem();
        break;
    }
    this.updatePanel();
    ev.preventDefault();
    return false;
};

/**************************************/
B220ControlConsole.prototype.resetTimer = function resetTimer(ev) {
    /* Resets the Interval Timer display to 0000.0 */

    this.p.resetRunTimer();
};

/**************************************/
B220ControlConsole.prototype.switch_Click = function switch_Click(ev) {
    /* Handler for switch & knob clicks */
    var p = this.p;                     // local copy of processor object

    if (p.poweredOn) {
        switch (ev.target.id) {
        case "StopSwitch":
            this.stopSwitch.flip();
            p.setStop();
            break;
        case "StartSwitch":
            this.startSwitch.flip();
            this.keyboard.keyboardEnable(0);
            p.start();
            break;
        case "StepSwitch":
            this.stepSwitch.flip();
            //this.keyboard.keyboardEnable(0);
            p.step();
            break;
        case "ClearSwitch":
            this.clearSwitch.flip();
            this.keyboard.keyboardEnable(0);
            p.stop();
            p.clear();
            break;

        case "A_RightClear":
            p.A.set(0);
            break;
        case "B_RightClear":
            p.B.set(0);
            break;
        case "C_RightClear":
            p.C.set(0);
            break;
        case "D_RightClear":
            p.D.set(0);
            break;
        case "E_RightClear":
            p.E.set(0);
            break;
        case "P_RightClear":
            p.P.set(0);
            break;
        case "R_RightClear":
            p.R.set(0);
            break;
        case "S_RightClear":
            p.S.set(0);
            break;

        case "ControlSwitch1":
            this.controlSwitch1.flip();
            this.config.putNode("ControlConsole.PCS1SW", this.controlSwitch1.state);
            p.PC1SW = this.controlSwitch1.state;
            break;
        case "ControlSwitch2":
            this.controlSwitch2.flip();
            this.config.putNode("ControlConsole.PCS2SW", this.controlSwitch2.state);
            p.PC2SW = this.controlSwitch2.state;
            break;
        case "ControlSwitch3":
            this.controlSwitch3.flip();
            this.config.putNode("ControlConsole.PCS3SW", this.controlSwitch3.state);
            p.PC3SW = this.controlSwitch3.state;
            break;
        case "ControlSwitch4":
            this.controlSwitch4.flip();
            this.config.putNode("ControlConsole.PCS4SW", this.controlSwitch4.state);
            p.PC4SW = this.controlSwitch4.state;
            break;
        case "ControlSwitch5":
            this.controlSwitch5.flip();
            this.config.putNode("ControlConsole.PCS5SW", this.controlSwitch5.state);
            p.PC5SW = this.controlSwitch5.state;
            break;
        case "ControlSwitch6":
            this.controlSwitch6.flip();
            this.config.putNode("ControlConsole.PCS6SW", this.controlSwitch6.state);
            p.PC6SW = this.controlSwitch6.state;
            break;
        case "ControlSwitch7":
            this.controlSwitch7.flip();
            this.config.putNode("ControlConsole.PCS7SW", this.controlSwitch7.state);
            p.PC7SW = this.controlSwitch7.state;
            break;
        case "ControlSwitch8":
            this.controlSwitch8.flip();
            this.config.putNode("ControlConsole.PCS8SW", this.controlSwitch8.state);
            p.PC8SW = this.controlSwitch8.state;
            break;
        case "ControlSwitch9":
            this.controlSwitch9.flip();
            this.config.putNode("ControlConsole.PCS9SW", this.controlSwitch9.state);
            p.PC9SW = this.controlSwitch9.state;
            break;
        case "ControlSwitch10":
            this.controlSwitch10.flip();
            this.config.putNode("ControlConsole.PCS0SW", this.controlSwitch10.state);
            p.PC0SW = this.controlSwitch10.state;
            break;

        case "KeyboardSwitch":
            this.keyboardSwitch.flip();
            if (!p.RUT.value && !p.computerNotReady.value) {
                this.keyboard.keyboardEnable(1);
            }
            break;
        case "SOnSwitch":
            this.sOnSwitch.flip();
            this.config.putNode("ControlConsole.SONSW", this.sOnSwitch.state);
            p.SONSW = this.sOnSwitch.state;
            break;
        case "UnitsSwitch":
            this.unitsSwitch.flip();
            this.config.putNode("ControlConsole.SUNITSSW", this.unitsSwitch.state);
            p.SUNITSSW = this.unitsSwitch.state;
            break;
        case "SToPSwitch":
            this.sToPSwitch.flip();
            this.config.putNode("ControlConsole.STOPSW", this.sToPSwitch.state);
            p.STOPSW = this.sToPSwitch.state;
            break;
        case "SToCSwitch":
            this.sToCSwitch.flip();
            this.config.putNode("ControlConsole.STOCSW", this.sToCSwitch.state);
            p.STOCSW = this.sToCSwitch.state;
            break;
        case "ResetTransferSwitch":
            this.resetTransferSwitch.flip();
            this.keyboard.keyboardEnable(0);
            p.resetTransfer();
            break;
        case "TCUClearSwitch":
            this.tcuClearSwitch.flip();
            p.tcuClear();
            break;

        case "ProgramCheckLamp":
            p.setProgramCheck(0);
            break;
        case "StorageLamp":
            p.setStorageCheck(0);
            break;
        case "MagneticTapeLamp":
            p.setMagneticTapeCheck(0);
            break;
        case "CardatronLamp":
            p.setCardatronCheck(0);
            break;
        case "PaperTapeLamp":
            p.setPaperTapeCheck(0);
            break;
        case "HighSpeedPrinterLamp":
            p.setHighSpeedPrinterCheck(0);
            break;

        case "FetchLamp":
            p.setCycle(0);
            break;
        case "ExecuteLamp":
            p.setCycle(1);
            break;

        case "OverflowLamp":
            p.OFT.flip();
            break;
        case "RepeatLamp":
            p.RPT.flip();
            break;
        case "LowLamp":
            p.toggleCompare(-1);
            break;
        case "EqualLamp":
            p.toggleCompare(0);
            break;
        case "HighLamp":
            p.toggleCompare(+1);
            break;
        } // switch ev.target.id
    }

    this.updatePanel();
    ev.preventDefault();
    return false;
};

/**************************************/
B220ControlConsole.prototype.consoleOnLoad = function consoleOnLoad() {
    /* Initializes the Supervisory Panel window and user interface */
    var body;
    var p = this.p;                     // local copy of processor object
    var panel;
    var prefs = this.config.getNode("ControlConsole");
    var x;

    this.doc = this.window.document;
    body = this.$$("PanelSurface");

    this.intervalTimer = this.$$("IntervalTimer");

    // Main Registers

    this.regA = new PanelRegister(this.$$("ARegPanel"), 11*4, 4, "A_", "A");
    this.regB = new PanelRegister(this.$$("BRegPanel"),  4*4, 4, "B_", "B");
    this.regC = new PanelRegister(this.$$("CRegPanel"), 10*4, 4, "C_", "C");
    this.regD = new PanelRegister(this.$$("DRegPanel"), 11*4, 4, "D_", "D");
    this.regE = new PanelRegister(this.$$("ERegPanel"),  4*4, 4, "E_", "E");
    this.regR = new PanelRegister(this.$$("RRegPanel"), 11*4, 4, "R_", "R");
    this.regP = new PanelRegister(this.$$("PRegPanel"),  4*4, 4, "P_", "P");
    this.regS = new PanelRegister(this.$$("SRegPanel"),  4*4, 4, "S_", "S");

    this.regA.drawBox(6, 2, 4, "2px solid white", "2px solid white");
    this.regC.drawBox(5, 2, 4, "2px solid white", "2px solid white");
    this.regD.drawBox(6, 2, 4, "2px solid white", "2px solid white");
    this.regR.drawBox(6, 2, 4, "2px solid white", "2px solid white");

    // Status Panels

    panel = this.$$("AlarmPanel");
    this.digitCheckLamp =       new ColoredLamp(panel, null, null, "DigitCheckLamp", "redLamp lampCollar", "redLit");
    this.programCheckLamp =     new ColoredLamp(panel, null, null, "ProgramCheckLamp", "redLamp lampCollar", "redLit");
    this.storageLamp =          new ColoredLamp(panel, null, null, "StorageLamp", "redLamp lampCollar", "redLit");
    this.magneticTapeLamp =     new ColoredLamp(panel, null, null, "MagneticTapeLamp", "redLamp lampCollar", "redLit");
    this.cardatronLamp =        new ColoredLamp(panel, null, null, "CardatronLamp", "redLamp lampCollar", "redLit");
    this.paperTapeLamp =        new ColoredLamp(panel, null, null, "PaperTapeLamp", "redLamp lampCollar", "redLit");
    this.highSpeedPrinterLamp = new ColoredLamp(panel, null, null, "HighSpeedPrinterLamp", "redLamp lampCollar", "redLit");
    this.systemNotReadyLamp =   new ColoredLamp(panel, null, null, "SystemNotReadyLamp", "redLamp lampCollar", "redLit");
    this.computerNotReadyLamp = new ColoredLamp(panel, null, null, "ComputerNotReadyLamp", "redLamp lampCollar", "redLit");

    panel = this.$$("OperationPanel");
    this.runLamp =              new ColoredLamp(panel, null, null, "RunLamp", "blueLamp lampCollar", "blueLit");
    this.fetchLamp =            new ColoredLamp(panel, null, null, "FetchLamp", "blueLamp lampCollar", "blueLit");
    this.executeLamp =          new ColoredLamp(panel, null, null, "ExecuteLamp", "blueLamp lampCollar", "blueLit");

    panel = this.$$("StatusPanel");
    this.overflowLamp =         new ColoredLamp(panel, null, null, "OverflowLamp", "blueLamp lampCollar", "blueLit");
    this.repeatLamp =           new ColoredLamp(panel, null, null, "RepeatLamp", "blueLamp lampCollar", "blueLit");
    this.lowLamp =              new ColoredLamp(panel, null, null, "LowLamp", "blueLamp lampCollar", "blueLit");
    this.equalLamp =            new ColoredLamp(panel, null, null, "EqualLamp", "blueLamp lampCollar", "blueLit");
    this.highLamp =             new ColoredLamp(panel, null, null, "HighLamp", "blueLamp lampCollar", "blueLit");

    // Organ Switches

    panel = this.$$("ControlSwitchPanel");
    this.controlSwitch1 = new OrganSwitch(panel, null, null, "ControlSwitch1",
            B220ControlConsole.offOrganSwitchImage, B220ControlConsole.onOrganSwitchImage, false);
    this.controlSwitch1.set(this.config.getNode("ControlConsole.PCS1SW"));
    p.PC1SW = this.controlSwitch1.state;

    this.controlSwitch2 = new OrganSwitch(panel, null, null, "ControlSwitch2",
            B220ControlConsole.offOrganSwitchImage, B220ControlConsole.onOrganSwitchImage, false);
    this.controlSwitch2.set(this.config.getNode("ControlConsole.PCS2SW"));
    p.PC2SW = this.controlSwitch2.state;

    this.controlSwitch3 = new OrganSwitch(panel, null, null, "ControlSwitch3",
            B220ControlConsole.offOrganSwitchImage, B220ControlConsole.onOrganSwitchImage, false);
    this.controlSwitch3.set(this.config.getNode("ControlConsole.PCS3SW"));
    p.PC3SW = this.controlSwitch3.state;

    this.controlSwitch4 = new OrganSwitch(panel, null, null, "ControlSwitch4",
            B220ControlConsole.offOrganSwitchImage, B220ControlConsole.onOrganSwitchImage, false);
    this.controlSwitch4.set(this.config.getNode("ControlConsole.PCS4SW"));
    p.PC4SW = this.controlSwitch4.state;

    this.controlSwitch5 = new OrganSwitch(panel, null, null, "ControlSwitch5",
            B220ControlConsole.offOrganSwitchImage, B220ControlConsole.onOrganSwitchImage, false);
    this.controlSwitch5.set(this.config.getNode("ControlConsole.PCS5SW"));
    p.PC5SW = this.controlSwitch5.state;

    this.controlSwitch6 = new OrganSwitch(panel, null, null, "ControlSwitch6",
            B220ControlConsole.offOrganSwitchImage, B220ControlConsole.onOrganSwitchImage, false);
    this.controlSwitch6.set(this.config.getNode("ControlConsole.PCS6SW"));
    p.PC6SW = this.controlSwitch6.state;

    this.controlSwitch7 = new OrganSwitch(panel, null, null, "ControlSwitch7",
            B220ControlConsole.offOrganSwitchImage, B220ControlConsole.onOrganSwitchImage, false);
    this.controlSwitch7.set(this.config.getNode("ControlConsole.PCS7SW"));
    p.PC7SW = this.controlSwitch7.state;

    this.controlSwitch8 = new OrganSwitch(panel, null, null, "ControlSwitch8",
            B220ControlConsole.offOrganSwitchImage, B220ControlConsole.onOrganSwitchImage, false);
    this.controlSwitch8.set(this.config.getNode("ControlConsole.PCS8SW"));
    p.PC8SW = this.controlSwitch8.state;

    this.controlSwitch9 = new OrganSwitch(panel, null, null, "ControlSwitch9",
            B220ControlConsole.offOrganSwitchImage, B220ControlConsole.onOrganSwitchImage, false);
    this.controlSwitch9.set(this.config.getNode("ControlConsole.PCS9SW"));
    p.PC9SW = this.controlSwitch9.state;

    this.controlSwitch10 = new OrganSwitch(panel, null, null, "ControlSwitch10",
            B220ControlConsole.offOrganSwitchImage, B220ControlConsole.onOrganSwitchImage, false);
    this.controlSwitch10.set(this.config.getNode("ControlConsole.PCS0SW"));
    p.PC0SW = this.controlSwitch10.state;

    panel = this.$$("OperationSwitchPanel");
    this.stopSwitch = new OrganSwitch(panel, null, null, "StopSwitch",
            B220ControlConsole.offOrganSwitchImage, B220ControlConsole.onOrganSwitchImage, true);
    this.startSwitch = new OrganSwitch(panel, null, null, "StartSwitch",
            B220ControlConsole.offOrganSwitchImage, B220ControlConsole.onOrganSwitchImage, true);
    this.stepSwitch = new OrganSwitch(panel, null, null, "StepSwitch",
            B220ControlConsole.offOrganSwitchImage, B220ControlConsole.onOrganSwitchImage, true);
    this.clearSwitch = new OrganSwitch(panel, null, null, "ClearSwitch",
            B220ControlConsole.offOrganSwitchImage, B220ControlConsole.onOrganSwitchImage, true);

    panel = this.$$("MiscellaneousSwitchPanel");
    this.keyboardSwitch = new OrganSwitch(panel, null, null, "KeyboardSwitch",
            B220ControlConsole.offOrganSwitchImage, B220ControlConsole.onOrganSwitchImage, true);

    this.sOnSwitch = new OrganSwitch(panel, null, null, "SOnSwitch",
            B220ControlConsole.offOrganSwitchImage, B220ControlConsole.onOrganSwitchImage, false);
    this.sOnSwitch.set(this.config.getNode("ControlConsole.SONSW"));
    p.SONSW = this.sOnSwitch.state;

    this.unitsSwitch = new OrganSwitch(panel, null, null, "UnitsSwitch",
            B220ControlConsole.offOrganSwitchImage, B220ControlConsole.onOrganSwitchImage, false);
    this.unitsSwitch.set(this.config.getNode("ControlConsole.SUNITSSW"));
    p.SUNITSSW = this.unitsSwitch.state;

    this.sToPSwitch = new OrganSwitch(panel, null, null, "SToPSwitch",
            B220ControlConsole.offOrganSwitchImage, B220ControlConsole.onOrganSwitchImage, false);
    this.sToPSwitch.set(this.config.getNode("ControlConsole.STOPSW"));
    p.STOPSW = this.sToPSwitch.state;

    this.sToCSwitch = new OrganSwitch(panel, null, null, "SToCSwitch",
            B220ControlConsole.offOrganSwitchImage, B220ControlConsole.onOrganSwitchImage, false);
    this.sToCSwitch.set(this.config.getNode("ControlConsole.STOCSW"));
    p.STOCSW = this.sToCSwitch.state;

    this.resetTransferSwitch = new OrganSwitch(panel, null, null, "ResetTransferSwitch",
            B220ControlConsole.offOrganSwitchImage, B220ControlConsole.onOrganSwitchImage, true);
    this.tcuClearSwitch = new OrganSwitch(panel, null, null, "TCUClearSwitch",
            B220ControlConsole.offOrganSwitchImage, B220ControlConsole.onOrganSwitchImage, true);

    // Events
    this.regA.addEventListener("click", this.boundLamp_Click);
    this.regB.addEventListener("click", this.boundLamp_Click);
    this.regC.addEventListener("click", this.boundLamp_Click);
    this.regD.addEventListener("click", this.boundLamp_Click);
    this.regE.addEventListener("click", this.boundLamp_Click);
    this.regP.addEventListener("click", this.boundLamp_Click);
    this.regR.addEventListener("click", this.boundLamp_Click);
    this.regS.addEventListener("click", this.boundLamp_Click);

    this.regA.rightClearBar.addEventListener("click", this.boundSwitch_Click);
    this.regB.rightClearBar.addEventListener("click", this.boundSwitch_Click);
    this.regC.rightClearBar.addEventListener("click", this.boundSwitch_Click);
    this.regD.rightClearBar.addEventListener("click", this.boundSwitch_Click);
    this.regE.rightClearBar.addEventListener("click", this.boundSwitch_Click);
    this.regP.rightClearBar.addEventListener("click", this.boundSwitch_Click);
    this.regR.rightClearBar.addEventListener("click", this.boundSwitch_Click);
    this.regS.rightClearBar.addEventListener("click", this.boundSwitch_Click);

    this.programCheckLamp.addEventListener("click", this.boundSwitch_Click);
    this.storageLamp.addEventListener("click", this.boundSwitch_Click);
    this.magneticTapeLamp.addEventListener("click", this.boundSwitch_Click);
    this.cardatronLamp.addEventListener("click", this.boundSwitch_Click);
    this.paperTapeLamp.addEventListener("click", this.boundSwitch_Click);
    this.highSpeedPrinterLamp.addEventListener("click", this.boundSwitch_Click);

    this.fetchLamp.addEventListener("click", this.boundSwitch_Click);
    this.executeLamp.addEventListener("click", this.boundSwitch_Click);

    this.overflowLamp.addEventListener("click", this.boundSwitch_Click);
    this.repeatLamp.addEventListener("click", this.boundSwitch_Click);
    this.lowLamp.addEventListener("click", this.boundSwitch_Click);
    this.equalLamp.addEventListener("click", this.boundSwitch_Click);
    this.highLamp.addEventListener("click", this.boundSwitch_Click);

    this.controlSwitch1.addEventListener("click", this.boundSwitch_Click);
    this.controlSwitch2.addEventListener("click", this.boundSwitch_Click);
    this.controlSwitch3.addEventListener("click", this.boundSwitch_Click);
    this.controlSwitch4.addEventListener("click", this.boundSwitch_Click);
    this.controlSwitch5.addEventListener("click", this.boundSwitch_Click);
    this.controlSwitch6.addEventListener("click", this.boundSwitch_Click);
    this.controlSwitch7.addEventListener("click", this.boundSwitch_Click);
    this.controlSwitch8.addEventListener("click", this.boundSwitch_Click);
    this.controlSwitch9.addEventListener("click", this.boundSwitch_Click);
    this.controlSwitch10.addEventListener("click", this.boundSwitch_Click);

    this.stopSwitch.addEventListener("click", this.boundSwitch_Click);
    this.startSwitch.addEventListener("click", this.boundSwitch_Click);
    this.stepSwitch.addEventListener("click", this.boundSwitch_Click);
    this.clearSwitch.addEventListener("click", this.boundSwitch_Click);

    this.keyboardSwitch.addEventListener("click", this.boundSwitch_Click);
    this.sOnSwitch.addEventListener("click", this.boundSwitch_Click);
    this.unitsSwitch.addEventListener("click", this.boundSwitch_Click);
    this.sToPSwitch.addEventListener("click", this.boundSwitch_Click);
    this.sToCSwitch.addEventListener("click", this.boundSwitch_Click);
    this.resetTransferSwitch.addEventListener("click", this.boundSwitch_Click);
    this.tcuClearSwitch.addEventListener("click", this.boundSwitch_Click);

    this.$$("IntervalTimerResetBtn").addEventListener("click", this.boundResetTimer);
    this.$$("PowerOffBtn").addEventListener("click", this.boundPowerBtn_Click);

    this.window.addEventListener("beforeunload", B220ControlConsole.prototype.beforeUnload);

    this.$$("EmulatorVersion").textContent = B220Processor.version;

    // Power on the system by default...
    setCallback(this.mnemonic, this, 1000, function powerOnTimer() {
        this.powerOnSystem();
    });
};

/**************************************/
B220ControlConsole.prototype.keyboardOpen = function keyboardOpen() {
    /* Signals the Control Console to open the keyboard window if it's not
    already open */

    this.keyboard.keyboardOpen();
};

/**************************************/
B220ControlConsole.prototype.outputUnitSelect = function outputUnitSelect(unitNr, successor) {
    /* Prepares for paper-tape or SPO output by selecting the first ready device
    having a unitMask matching the unitNr parameter. If one is found, returns
    that index and schedules initiateOutput() for the unit. If no such unit is
    found, returns -1 */
    var result = -1;                    // be pessimistic
    var u = null;                       // output unit object
    var x;                              // for loop index

    for (x=0; x<this.outputUnit.length; ++x) {
        u = this.outputUnit[x];
        if (u && u.ready) {
            if (u.unitMask & B220Processor.pow2[unitNr]) {
                result = x;
                setCallback(this.mnemonic, u, 1, u.initiateOutput, successor);
                break; // out of for loop
            }
        }
    }

    return result;
};

/**************************************/
B220ControlConsole.prototype.shutDown = function shutDown() {
    /* Shuts down the panel */
    var x;

    this.window.removeEventListener("beforeunload", B220ControlConsole.prototype.beforeUnload);
    if (this.intervalToken) {
        this.window.clearInterval(this.intervalToken);
    }

    this.keyboard.shutDown();
    this.keyboard = null;
    for (x=0; x<this.outputUnit.length; ++x) {
        if (this.outputUnit[x]) {
            this.outputUnit[x].shutDown();
            this.outputUnit[x] = null;
        }
    }

    this.window.close();
};