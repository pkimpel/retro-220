/***********************************************************************
* retro-220/webUI B220SystemConfig.js
************************************************************************
* Copyright (c) 2017, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* Burroughs 220 Emulator System Configuration management object.
*
* Defines the system configuration used internally by the emulator and the
* methods used to manage that configuration data.
*
************************************************************************
* 2017-01-01  P.Kimpel
*   Original version, from retro-205 webUI/D205SystemConfig.js.
***********************************************************************/
"use strict";

/**************************************/
function B220SystemConfig() {
    /* Constructor for the SystemConfig configuration management object */
    var s;

    this.flushTimer = 0;                // timer token for flushing configuration to localStorage
    this.window = null;                 // configuration UI window object
    this.alertWin = window;             // current base window for alert/confirm/prompt

    // Load or create the system configuration data
    s = localStorage.getItem(this.configStorageName);
    if (!s) {
        this.createConfigData();
    } else {
        this.loadConfigData(s);
    }
}

/**************************************/
B220SystemConfig.prototype.configStorageName = "retro-220-Config";
B220SystemConfig.prototype.configVersion = 1;
B220SystemConfig.prototype.flushDelay = 60000;  // flush timer setting, ms

B220SystemConfig.defaultConfig = {
    version: this.configVersion,
    memorySize: 5000,               // 11-digit words

    ControlConsole: {
        PCS1SW: 0,                      // Program Control Switches 1-0
        PCS2SW: 0,
        PCS3SW: 0,
        PCS4SW: 0,
        PCS5SW: 0,
        PCW6SW: 0,
        PCS7SW: 0,
        PCS8SW: 0,
        PCS9SW: 0,
        PCS0SW: 0,
        SONSW: 0,                       // S-register on
        SUNITSSW: 0,                    // S-register units
        STOCSW: 0,                      // S-to-C stop
        STOPSW: 0},                     // S-to-P stop

    ConsoleInput: {
        units: [
            null,                       // unit[0] not used
            {type: "PTRA", unitMask: 0x002, remote: 1, speed: 0},
            {type: "NONE"},
            {type: "NONE"},
            {type: "NONE"},
            {type: "NONE"},
            {type: "NONE"},
            {type: "NONE"},
            {type: "NONE"},
            {type: "NONE"},
            {type: "NONE"}
            ]},

    ConsoleOutput: {
        units: [
            {type: "TTYA", unitMask: 0x001, remote: 1, format: 0, zeroSuppress: 0, mapMemory: 0, printerSpeed: 0,
                           columns: 72, tabs: "9,17,25,33,41,49,57,65,73,81"},
            {type: "NONE"},
            {type: "NONE"},
            {type: "NONE"},
            {type: "NONE"},
            {type: "NONE"},
            {type: "NONE"},
            {type: "NONE"},
            {type: "NONE"},
            {type: "NONE"},
            {type: "NONE"}
            ]},

    Cardatron: {
        hasCardatron: true,
        units: [
            null,                       // unit[0] not used
            {type: "CR1", formatSelect: 0, formatCol: 1},
            {type: "NONE"},
            {type: "NONE"},
            {type: "NONE"},
            {type: "NONE"},
            {type: "LP2", algolGlyphs: true, greenBar: true,  zeroSuppressCols: ""},
            {type: "CP1", algolGlyphs: true, greenBar: false, zeroSuppressCols: ""}
            ]},

    MagTape: {
        hasMagTape: true,
        units: [
            null,                       // unit[0] not used
            {type: "MTA",  designate: 1},
            {type: "MTB",  designate: 2},
            {type: "NONE"},
            {type: "NONE"},
            {type: "NONE"},
            {type: "NONE"},
            {type: "NONE"},
            {type: "NONE"},
            {type: "NONE"},
            {type: "NONE"}
            ]}
    };


/**************************************/
B220SystemConfig.prototype.$$ = function $$(id) {
    return this.window.document.getElementById(id);
}

/**************************************/
B220SystemConfig.prototype.createConfigData = function createConfigData() {
    /* Creates and initializes a new configuration data object and stores it in
    localStorage. If former state preference objects exist, these are merged into
    the new data object and then deleted */
    var pref;
    var prefs;
    var s;

    this.configData = B220SystemConfig.defaultConfig;
    this.flushHandler();
};

/**************************************/
B220SystemConfig.prototype.loadConfigData = function loadConfigData(jsonConfig) {
    /* Attempts to parse the JSON configuration data string and store it in
    this.configData. If the parse is unsuccessful, recreates the default configuration.
    Applies any necessary updates to older configurations */

    try {
        this.configData = JSON.parse(jsonConfig);
    } catch (e) {
        alert("Could not parse system configuration data:\n" +
              e.message + "\nReinitializing configuration");
        this.createConfigData();
    }

    // Apply updates
    if (this.getNode("Cardatron.hasCardatron") === undefined) {
        this.putNode("Cardatron.hasCardatron", true);
    }

    if (this.getNode("MagTape.hasMagTape") === undefined) {
        this.putNode("MagTape.hasMagTape", true);
    }
};

/**************************************/
B220SystemConfig.prototype.flushHandler = function flushHandler() {
    /* Callback function for the flush timer. Stores the configuration data */

    this.flushTimer = 0;
    localStorage.setItem(this.configStorageName, JSON.stringify(this.configData));
};

/*************************************/
B220SystemConfig.prototype.flush = function flush() {
    /* If the current configuration data object has been modified, stores it to
    localStorage and resets the flush timer */

    if (this.flushTimer) {
        clearCallback(this.flushTimer);
        this.flushHandler();
    }
};

/**************************************/
B220SystemConfig.prototype.getNode = function getNode(nodeName, index) {
    /* Retrieves a specified node of the configuration data object tree.
    "nodeName" specifies the node using dotted-path format. A blank name
    retrieves the entire tree. If the "index" parameter is specified, the final
    node in the path is assumed to be an array, and "index" used to return
    that element of the array. If a node does not exist, returns undefined */
    var name;
    var names;
    var node = this.configData;
    var top;
    var x;

    name = nodeName.trim();
    if (name.length > 0) {
        names = name.split(".");
        top = names.length;
        for (x=0; x<top; ++x) {
            name = names[x];
            if (name in node) {
                node = node[name];
            } else {
                node = undefined;
                break; // out of for loop
            }
        } // for x
    }

    if (index === undefined) {
        return node;
    } else {
        return node[index];
    }
};

/**************************************/
B220SystemConfig.prototype.putNode = function putNode(nodeName, data, index) {
    /* Creates or replace a specified node of the configuration data object tree.
    "nodeName" specifies the node using dotted.path format. A blank name
    results in nothing being set. If a node does not exist, it and any necessary
    parent nodes are created. If the "index" parameter is specified, the final
    node in the path is assumed to be an array, and "index" is used to access
    that element of the array. Setting the value of a node starts a timer  (if it
    is not already started). When that timer expires, the configuration data will
    be flushed to the localStorage object. This delayed storage is done so that
    several configuration changes into short order can be grouped in one flush */
    var name;
    var names;
    var node = this.configData;
    var top;
    var x;

    name = nodeName.trim();
    if (name.length > 0) {
        names = name.split(".");
        top = names.length-1;
        for (x=0; x<top; ++x) {
            name = names[x];
            if (name in node) {
                node = node[name];
            } else {
                node = node[name] = {};
            }
        } // for x

        if (index === undefined) {
            node[names[top]] = data;
        } else {
            node[names[top]][index] = data;
        }

        if (!this.flushTimer) {
            this.flushTimer = setCallback("CONFIG", this, this.flushTimeout, this.flushHandler);
        }
    }
};

/***********************************************************************
*   System Configuration UI Support                                    *
***********************************************************************/

/**************************************/
B220SystemConfig.prototype.setListValue = function setListValue(id, value) {
    /* Sets the selection of the <select> list with the specified "id" to the
    entry with the specified "value". If no such value exists, the list
    selection is not changed */
    var e = this.$$(id);
    var opt;
    var x;

    if (e && e.tagName == "SELECT") {
        opt = e.options;
        for (x=0; x<opt.length; ++x) {
            if (opt[x].value == value) {
                e.selectedIndex = x;
                break; // out of for loop
            }
        } // for x
    }
};

/**************************************/
B220SystemConfig.prototype.loadConfigDialog = function loadConfigDialog() {
    /* Loads the configuration UI window with the settings from this.configData */
    var cd = this.configData;           // local configuration reference
    var mask;                           // unit mask bits
    var prefix;                         // unit id prefix
    var unit;                           // unit configuration object
    var x;                              // unit index
    var y;                              // secondary index

    // System Properties
    this.setListValue("SystemMemorySize", cd.memorySize.toString());

    // Console Input units

    if (!cd.ConsoleInput) {
        cd.ConsoleInput = B220SystemConfig.defaultConfig.ConsoleInput;
    }

    for (x=1; x<=10; ++x) {
        unit = cd.ConsoleInput.units[x];
        prefix = "ConsoleIn" + x;
        this.setListValue(prefix + "Type", unit.type);
        mask = 0x001;
        for (y=1; y<=10; ++y) {
            mask <<= 1;
            this.$$(prefix + "_" + y).checked = (unit.unitMask & mask ? true : false);
        } // for y
    } // for x

    // Console Output units

    if (!cd.ConsoleOutput) {
        cd.ConsoleOutput = B220SystemConfig.defaultConfig.ConsoleOutput;
    }

    for (x=0; x<=10; ++x) {
        unit = cd.ConsoleOutput.units[x];
        prefix = "ConsoleOut" + x;
        this.setListValue(prefix + "Type", unit.type);
        mask = 0x001;
        this.$$(prefix + "_SPO").checked = (unit.unitMask & mask ? true : false);
        for (y=1; y<=10; ++y) {
            mask <<= 1;
            this.$$(prefix + "_" + y).checked = (unit.unitMask & mask ? true : false);
        } // for y

        this.setListValue(prefix + "Format", unit.format);
        this.$$(prefix + "Columns").textContent = (unit.columns ? unit.columns : 72);
        this.$$(prefix + "Tabs").textContent = (unit.tabs ? unit.tabs : "");
    } // for x

    // Cardatron units

    if (!cd.Cardatron) {
        cd.Cardatron = B220SystemConfig.defaultConfig.Cardatron;
    }

    for (x=1; x<=7; ++x) {
        unit = cd.Cardatron.units[x];
        prefix = "Cardatron" + x;
        this.setListValue(prefix + "Type", unit.type);
        switch (unit.type.substring(0, 2)) {
        case "LP":
            this.$$(prefix + "AlgolGlyphs").checked = unit.algolGlyphs;
            this.$$(prefix + "Greenbar").checked = unit.greenBar;
            this.$$(prefix + "ZeroSuppressCols").textContent = unit.zeroSuppressCols || "";
            break;
        case "CP":
            this.$$(prefix + "AlgolGlyphs").checked = unit.algolGlyphs;
            this.$$(prefix + "Greenbar").checked = false;
            this.$$(prefix + "ZeroSuppressCols").textContent = unit.zeroSuppressCols || "";
            break;
        case "CR":
        default:
            this.$$(prefix + "AlgolGlyphs").checked = false;
            this.$$(prefix + "Greenbar").checked = false;
            this.$$(prefix + "ZeroSuppressCols").textContent = "";
            break;
        } // switch unit.type
    } // for x

    // Magnetic Tape units

    if (!cd.MagTape) {
        cd.MagTape = B220SystemConfig.defaultConfig.MagTape;
    }

    for (x=1; x<=10; ++x) {
        unit = cd.MagTape.units[x];
        prefix = "MagTape" + x;
        this.setListValue(prefix + "Type", unit.type);
        this.$$(prefix + "Designate").selectedIndex = unit.designate-1;
    } // for x

    this.$$("MessageArea").textContent = "220 System Configuration loaded.";
    this.window.focus();
};

/**************************************/
B220SystemConfig.prototype.saveConfigDialog = function saveConfigDialog() {
    /* Saves the configuration UI window settings to this.configData and flushes
    the updated configuration to localStorage */
    var cd = this.configData;           // local configuration reference
    var e;                              // local element reference
    var mask;                           // unit mask
    var prefix;                         // unit id prefix
    var unit;                           // unit configuration object
    var x;                              // unit index
    var y;                              // secondary index

    function getNumber(id, caption, min, max) {
        var n;
        var text = this.$$(id).value;

        n = parseInt(text, 10);
        if (isNaN(n)) {
            alert(caption + " must be numeric");
        } else if (n < min || n > max) {
            alert(caption + " must be in the range (" + min + ", " + max + ")");
            n = Number.NaN;
        }

        return n;
    }

    // System Properties

    e = this.$$("SystemMemorySize");
    x = parseInt(e.options[e.selectedIndex], 10);
    cd.memorySize = (isNaN(x) ? 5000 : x);

    // Console Input units

    for (x=1; x<=10; ++x) {
        unit = cd.ConsoleInput.units[x];
        prefix = "ConsoleIn" + x;
        e = this.$$(prefix + "Type");
        unit.type = (e.selectedIndex < 0 ? "NONE" : e.options[e.selectedIndex].value);
        mask = 0x001;
        unit.unitMask = 0;
        for (y=1; y<=10; ++y) {
            mask <<= 1;
            if (this.$$(prefix + "_" + y).checked) {
                unit.unitMask |= mask;
            }
        } // for y

        if (unit.type != "NONE") {
            unit.remote = (unit.remote || 0);
            unit.speed = (unit.speed || 0);
        }
    } // for x

    // Console Output units

    for (x=0; x<=10; ++x) {
        unit = cd.ConsoleOutput.units[x];
        prefix = "ConsoleOut" + x;
        e = this.$$(prefix + "Type");
        unit.type = (e.selectedIndex < 0 ? "NONE" : e.options[e.selectedIndex].value);
        mask = 0x001;
        unit.unitMask = 0;
        if (this.$$(prefix + "_SPO").checked) {
            unit.unitMask |= mask;
        }
        for (y=1; y<=10; ++y) {
            mask <<= 1;
            if (this.$$(prefix + "_" + y).checked) {
                unit.unitMask |= mask;
            }
        } // for y

        if (unit.type != "NONE") {
            unit.remote = (unit.remote || 0);
            unit.zeroSuppress = (unit.zeroSuppress || 0);
            unit.mapMemory = (unit.mapMemory || 0);
            unit.printerSpeed = (unit.printerSpeed || 0);
            e = this.$$(prefix + "Format");
            unit.format = (e.selectedIndex < 0 ? "NONE" : e.options[e.selectedIndex].value);
            unit.columns = (unit.columns ? unit.columns : 72);
            unit.tabs = (unit.tabs ? unit.tabs : "1,9,17,25,33,41,49,57,65,73");
        }
    } // for x

    // Cardatron units

    cd.Cardatron.hasCardatron = false;
    for (x=1; x<=7; ++x) {
        unit = cd.Cardatron.units[x];
        prefix = "Cardatron" + x;
        e = this.$$(prefix + "Type");
        unit.type = (e.selectedIndex < 0 ? "NONE" : e.options[e.selectedIndex].value);
        switch (unit.type.substring(0, 2)) {
        case "LP":
            cd.Cardatron.hasCardatron = true;
            unit.algolGlyphs = this.$$(prefix + "AlgolGlyphs").checked;
            unit.greenBar = this.$$(prefix + "Greenbar").checked;
            unit.zeroSuppressCols = (unit.zeroSuppressCols || "");
            break;
        case "CP":
            cd.Cardatron.hasCardatron = true;
            unit.algolGlyphs = this.$$(prefix + "AlgolGlyphs").checked;
            unit.greenBar = false;
            unit.zeroSuppressCols = (unit.zeroSuppressCols || "");
            break;
        case "CR":
            cd.Cardatron.hasCardatron = true;
            unit.formatSelect = (unit.formatSelect || 0);
            unit.formatCol = (unit.formatCol === undefined ? 1 : unit.formatCol)
            // no break
        default:
            unit.algolGlyphs = false;
            unit.greenBar = false;
            break;
        } // switch unit.type
    } // for x



    // Magnetic Tape units

    cd.MagTape.hasMagTape = false;

    for (x=1; x<=10; ++x) {
        unit = cd.MagTape.units[x];
        prefix = "MagTape" + x;
        e = this.$$(prefix + "Type");
        unit.type = (e.selectedIndex < 0 ? "NONE" : e.options[e.selectedIndex].value);
        unit.designate = this.$$(prefix + "Designate").selectedIndex+1;
        if (unit.type != "NONE") {
            cd.MagTape.hasMagTape = true;
        }
    } // for x

    this.flushHandler();                // store the configuration
    this.$$("MessageArea").textContent = "220 System Configuration updated.";
    this.window.close();
};

/**************************************/
B220SystemConfig.prototype.closeConfigUI = function closeConfigUI() {
    /* Closes the system configuration update dialog */

    this.alertWin = window;             // revert alerts to the global window
    window.focus();
    if (this.window) {
        if (!this.window.closed) {
            this.window.close();
        }
        this.window = null;
    }
}

/**************************************/
B220SystemConfig.prototype.openConfigUI = function openConfigUI() {
    /* Opens the system configuration update dialog and displays the current
    system configuration */

    function configUI_Load(ev) {
        this.$$("SaveBtn").addEventListener("click",
                B220Util.bindMethod(this, this.saveConfigDialog));
        this.$$("CancelBtn").addEventListener("click",
                B220Util.bindMethod(this, function(ev) {this.window.close()}));
        this.$$("DefaultsBtn").addEventListener("click",
                B220Util.bindMethod(this, function(ev) {
                    this.createConfigData();
                    this.loadConfigDialog();
        }));
        this.window.addEventListener("unload",
                B220Util.bindMethod(this, this.closeConfigUI), false);
        this.loadConfigDialog();
    }

    this.doc = null;
    this.window = window.open("../webUI/B220SystemConfig.html", this.configStorageName,
            "location=no,scrollbars,resizable,width=800,height=800");
    this.window.moveTo(screen.availWidth-this.window.outerWidth-40,
            (screen.availHeight-this.window.outerHeight)/2);
    this.window.focus();
    this.alertWin = this.window;
    this.window.addEventListener("load",
            B220Util.bindMethod(this, configUI_Load), false);
};
