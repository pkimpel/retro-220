/***********************************************************************
* retro-220/webUI B220Util.js
************************************************************************
* Copyright (c) 2017, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* Burroughs 220 Emulator common Javascript utilities module.
************************************************************************
* 2017-01-01  P.Kimpel
*   Original version, from retro-205 D205Util.js
***********************************************************************/
"use strict";

/**************************************/
function B220Util() {
    /* Constructor for the B220Util object */
    // Nothing to construct at present...
}


/**************************************/
B220Util.popupOpenDelayIncrement = 250; // increment for pop-up open delay adjustment, ms
B220Util.popupOpenDelay = 500;          // current pop-up open delay, ms
B220Util.popupOpenQueue = [];           // queue of pop-up open argument objects


/**************************************/
B220Util.xlateASCIIToAlgolRex =         // For translation of 220-ASCII to Algol-ASCII glyphs
        /[^\r\n\xA0 $()*+,-./0-9=@A-Za-z]/g;
B220Util.xlateASCIIToAlgolGlyph = {
        "#": "=",
        "%": "(",
        "&": "+",
        "<": ")",
        "\u00A4": ")"};         // the lozenge (¤)

B220Util.xlateAlgolToASCIIRex =         // For translation of Algol-ASCII glyphs to 220-ASCII
        /[^\r\n\xA0 #$%&*,-./0-9<@A-Za-z\xA4]/g;
B220Util.xlateAlgolToASCIIGlyph = {
        "=": "#",
        "(": "%",
        "+": "&",
        ")": "\u00A4"};         // the lozenge (¤)

/**************************************/
B220Util.$$ = function $$(e) {
    return document.getElementById(e);
};

/**************************************/
B220Util.hasClass = function hasClass(e, name) {
    /* returns true if element "e" has class "name" in its class list */

    return e.classList.contains(name);
};

/**************************************/
B220Util.addClass = function addClass(e, name) {
    /* Adds a class "name" to the element "e"s class list */

    e.classList.add(name);
};

/**************************************/
B220Util.removeClass = function removeClass(e, name) {
    /* Removes the class "name" from the element "e"s class list */

    e.classList.remove(name);
};

/**************************************/
B220Util.deepCopy = function deepCopy(source, dest) {
    /* Performs a deep copy of the object "source" into the object "dest".
    If "dest" is null or undefined, simply returns a deep copy of "source".
    Note that this routine clones the primitive Javascript types, basic
    objects (hash tables), Arrays, Dates, RegExps, and Functions. Other
    types may be supported by extending the switch statement. Also note
    this is a static function.
    Adapted (with thanks) from the "extend" routine by poster Kamarey on 2011-03-26 at
    http://stackoverflow.com/questions/122102/what-is-the-most-efficient-way-to-clone-an-object
    */
    var constr = null;
    var copy = null;
    var name = "";

    if (source === null) {
        return source;
    } else if (!(source instanceof Object)) {
        return source;
    } else {
        constr = source.constructor;
        if (constr !== Object && constr !== Array) {
            return source;
        } else {
            switch (constr) {
            case String:
            case Number:
            case Boolean:
            case Date:
            case Function:
            case RegExp:
                copy = new constr(source);
                break;
            default:
                copy = dest || new constr();
                break;
            }

            for (name in source) {
                copy[name] = deepCopy(source[name], null);
            }

            return copy;
        }
    }
};

/**************************************/
B220Util.xlateToAlgolChar = function xlateToAlgolChar(c) {
    /* Translates one BIC-as-ASCII Algol glyph character to Unicode */

    return B220Util.xlateASCIIToAlgolGlyph[c] || "?";
};

/**************************************/
B220Util.xlateASCIIToAlgol = function xlateASCIIToAlgol(text) {
    /* Translates the BIC-as-ASCII characters in "text" to equivalent Unicode glyphs */

    return text.replace(B220Util.xlateASCIIToAlgolRex, B220Util.xlateToAlgolChar);
};

/**************************************/
B220Util.xlateToASCIIChar = function xlateToASCIIChar(c) {
    /* Translates one Unicode Algol glyph to its BIC-as-ASCII equivalent */

    return B220Util.xlateAlgolToASCIIGlyph[c] || "?";
};

/**************************************/
B220Util.xlateAlgolToASCII = function xlateAlgolToASCII(text) {
    /* Translates the Unicode characters in "text" equivalent BIC-as-ASCII glyphs */

    return text.replace(B220Util.xlateAlgolToASCIIRex, B220Util.xlateToASCIIChar);
};

/**************************************/
B220Util.xlateDOMTreeText = function xlateDOMTreeText(n, xlate) {
    /* If Node "n" is a text node, translates its value using the "xlate"
    function. For all other Node types, translates all subordinate text nodes */
    var kid = null;

    if (n.nodeType == Node.TEXT_NODE) {
        n.nodeValue = xlate(n.nodeValue);
    } else {
        kid = n.firstChild;
        while (kid) {
            xlateDOMTreeText(kid, xlate);
            kid = kid.nextSibling;
        }
    }
};

/**************************************/
B220Util.openPopup = function openPopup(parent, url, windowName, options, context, onload) {
    /* Schedules the opening of a pop-up window so that browsers such as Apple
    Safari (11.0+) will not block the opens if they occur too close together. 
    Parameters:
        parent:     parent window for the pop-up
        url:        url of window context, passed to window.open()
        windowName: internal name of the window, passed to window.open()
        options:    string of window options, passed to window.open()
        context:    object context ("this") for the onload function (may be null)
        onload:     event handler for the window's onload event (may be null).
    If the queue of pending pop-up opens in B220Util.popupOpenQueue[] is empty,
    then attempts to open the window immediately. Otherwise queues the open
    parameters, which will be dequeued and acted upon after the previously-
    queued entries are completed by B220Util.dequeuePopup() */

    B220Util.popupOpenQueue.push({
        parent: parent,
        url: url,
        windowName: windowName,
        options: options,
        context: context,
        onload: onload});
    if (B220Util.popupOpenQueue.length == 1) { // queue was empty
        B220Util.dequeuePopup();
    }
};

/**************************************/
B220Util.dequeuePopup = function dequeuePopup() {
    /* Dequeues a popupOpenQueue[] entry and attempts to open the pop-up window.
    Called either directly by B220Util.openPopup() when an entry is inserted
    into an empty queue, or by setTimeout() after a delay. If the open fails,
    the entry is reinserted into the head of the queue, the open delay is
    incremented, and this function is rescheduled for the new delay. If the
    open is successful, and the queue is non-empty, then this function is
    scheduled for the current open delay to process the next entry in the queue */
    var entry = B220Util.popupOpenQueue.shift();
    var loader1 = null;
    var loader2 = null;
    var win = null;

    if (entry) {
        try {
            win = entry.parent.open(entry.url, entry.windowName, entry.options);
        } catch (e) {
            win = null;
        }

        if (!win) {                     // window open failed, requeue
            B220Util.popupOpenQueue.unshift(entry);
            B220Util.popupOpenDelay += B220Util.popupOpenDelayIncrement;
            setTimeout(B220Util.dequeuePopup, B220Util.popupOpenDelay);
            //console.log("Pop-up open failed: " + entry.windowName + ", new delay=" + B220Util.popupOpenDelay + "ms");
        } else {                        // window open was successful
            if (entry.onload) {
                loader1 = entry.onload.bind(entry.context);
                win.addEventListener("load", loader1, false);
            }

            loader2 = function(ev) {    // remove the load event listeners after loading
                win.removeEventListener("load", loader2, false);   
                if (loader1) {
                    win.removeEventListener("load", loader1, false);
                }
            };

            win.addEventListener("load", loader2, false);
            if (B220Util.popupOpenQueue.length > 0) {
                setTimeout(B220Util.dequeuePopup, B220Util.popupOpenDelay);
            }
        }
    }
};