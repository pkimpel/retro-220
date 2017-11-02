/***********************************************************************
* retro-220/emulator B220Processor.js
************************************************************************
* Copyright (c) 2017, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* Burroughs 220 Emulator Processor (CPU) module.
*
* Instance variables in all caps generally refer to register or flip-flop (FF)
* entities in the processor hardware. See the following documents:
*
*   Burroughs 220 Operational Characterists Manual
*       (Bulletin 5020A, Burroughs Corporation, revised August 1960).
*   Handbook of Operating Procedures for the Burroughs 220
*       (Bulletin 5023, Burroughs Corporation, November 1959).
*   Burroughs 220 Schematics
*       (Technical Manual 4053-1, Burroughs Corporation, December 1958).
*   Datatron 220 Schematics, Section I [CPU.pdf]
*       (Technical Manual 4053, Burroughs Corporation, December 1958).
*
* available at:
*   http://bitsavers.org/pdf/burroughs/electrodata/220/
*
* also:
*
*   An Introduction to Coding the Burroughs 220
*       (Bulletin 5019, Burroughs Corporation, December, 1958).
*
* Burroughs 220 word format:
*   44 bits, encoded as binary-coded decimal (BCD); non-decimal codes are
*   invalid and cause the computer to stop with a Digit Check alarm, also known
*   as a Forbidden Combination (FC).
*
*   High-order 4 bits are the "sign digit":
*       Low-order bit of this digit is the actual sign.
*       Higher-order bits are used in some I/O operations.
*   Remaining 40 bits are the value as:
*       10 decimal digits as a fractional mantissa, with the decimal point
*           between the sign and high-order (10th) digits
*       a floating point value with the first two digits as the exponent (biased
*           by 50) followed by a fractional 8-digit mantissa
*       5 two-digit character codes
*       one instruction word
*
*   Instruction word format:
*       Low-order 4 digits: operand address
*       Next-higher 2 digits: operation code
*       Next-higher 4 digits: control and variant digits used by some instructions
*       Sign digit: odd value indicates the B register is to be added to the
*           operand address prior to execution.
*
* Processor timing is maintained internally in units of milliseconds.
*
************************************************************************
* 2017-01-01  P.Kimpel
*   Original version, cloned from retro-205 emulator/D205Processor.js.
***********************************************************************/
"use strict";

/**************************************/
function B220Processor(config, devices) {
    /* Constructor for the 220 Processor module object */

    this.mnemonic = "CPU";
    B220Processor.instance = this;      // externally-available object reference (for DiagMonitor)

    // Emulator control
    this.cardatron = null;              // reference to Cardatron Control Unit
    this.config = config;               // reference to SystemConfig object
    this.console = null;                // reference to Control Console for I/O
    this.devices = devices;             // hash of I/O device objects
    this.ioCallback = null;             // current I/O interface callback function
    this.magTape = null;                // reference to Magnetic Tape Control Unit
    this.poweredOn = 0;                 // system is powered on and initialized
    this.successor = null;              // current delayed-action successor function

    // Memory
    this.memorySize = config.getNode("memorySize");     // memory size, words
    this.bcdMemorySize = B220Processor.binaryBCD(this.memorySize);
    this.MM = new Float64Array(this.memorySize);        // main memory, 11-digit words
    this.IB = new B220Processor.Register(11*4, this, true);     // memory Input Buffer

    // Processor throttling control and timing statistics
    this.execClock = 0;                 // emulated internal processor clock, ms
    this.execLimit = 0;                 // current time slice limit on this.execClock, ms
    this.opTime = 0;                    // estimated time for current instruction, ms
    this.procStart = 0;                 // Javascript time that the processor started running, ms
    this.procTime = 0;                  // total internal running time for processor, ms
    this.runStamp = 0;                  // timestamp of last run() slice, ms
    this.runTimer = 0;                  // elapsed run-time timer value, ms
    this.scheduler = 0;                 // current setCallback token

    this.procSlack = 0;                 // total processor throttling delay, ms
    this.procSlackAvg = 0;              // average slack time per time slice, ms
    this.procRunAvg = 0;                // average elapsed time per time slice, ms

    this.delayDeltaAvg = 0;             // average difference between requested and actual setCallback() delays, ms
    this.delayLastStamp = 0;            // timestamp of last setCallback() delay, ms
    this.delayRequested = 0;            // last requested setCallback() delay, ms

    // Primary Registers
    this.A = new B220Processor.Register(11*4, this, false);
    this.B = new B220Processor.Register( 4*4, this, false);
    this.C = new B220Processor.Register(10*4, this, false);
    this.D = new B220Processor.Register(11*4, this, false);
    this.E = new B220Processor.Register( 4*4, this, false);
    this.P = new B220Processor.Register( 4*4, this, false);
    this.R = new B220Processor.Register(11*4, this, false);
    this.S = new B220Processor.Register( 4*4, this, false);

    // Register E decrements modulo the system memory size, so override dec().
    this.E.dec = function decE() {
        if (this.value == 0) {
            this.value = this.p.bcdMemorySize;
        }
        return this.constructor.prototype.dec.apply(this);
    };

    // Control Console Lamps
    this.digitCheckAlarm =      new B220Processor.FlipFlop(this, false);

    this.systemNotReady =       new B220Processor.FlipFlop(this, false);
    this.computerNotReady =     new B220Processor.FlipFlop(this, false);

    this.compareLowLamp =       new B220Processor.FlipFlop(this, false);
    this.compareEqualLamp =     new B220Processor.FlipFlop(this, false);
    this.compareHighLamp =      new B220Processor.FlipFlop(this, false);

    // Control Console Switches
    this.PC1SW = 0;                     // program control switches 1-10
    this.PC2SW = 0;
    this.PC3SW = 0;
    this.PC4SW = 0;
    this.PC5SW = 0;
    this.PC6SW = 0;
    this.PC7SW = 0;
    this.PC8SW = 0;
    this.PC9SW = 0;
    this.PC0SW = 0;

    this.SONSW = 0;                     // S "On" switch
    this.SUNITSSW = 0;                  // S units switch
    this.STOCSW = 0;                    // S to C switch
    this.STOPSW = 0;                    // S to P switch

    // Left-Hand Maintenance Panel Switches
    this.HOLDPZTZEROSW = 0;
    this.LEADINGZEROESSW = 0;
    this.PAPERTAPESUMSW = 0;
    this.ORDERCOMPLEMENTSW = 0;
    this.MEMORYLOCKOUTSW = 0;
    this.DCLOCKOUTSW = 0;
    this.SPDPHOLDSW = 0;
    this.HOLDSEQUENCE1SW = 0;
    this.HOLDSEQUENCE2SW = 0;
    this.HOLDSEQUENCE4SW = 0;
    this.HOLDSEQUENCE8SW = 0;

    // Left-Hand Maintenance Panel Registers & Flip-Flops
    this.CI = new B220Processor.Register(5, this, false);       // carry inverters
    this.DC = new B220Processor.Register(6, this, false);       // digit counter (modulo 20)
    this.SC = new B220Processor.Register(4, this, false);       // sequence counter
    this.SI = new B220Processor.Register(4, this, false);       // sum inverters
    this.X =  new B220Processor.Register(4, this, false);       // adder X (augend) input
    this.Y =  new B220Processor.Register(4, this, false);       // adder Y (addend) input
    this.Z =  new B220Processor.Register(4, this, false);       // decimal sum inverters, adder output

    this.CI.checkFC = B220Processor.emptyFunction;              // these registers generate A-F undigits
    this.SI.checkFC = B220Processor.emptyFunction;

    this.C10 = new B220Processor.FlipFlop(this, false);         // decimal carry toggle
    this.DST = new B220Processor.FlipFlop(this, false);         // D-sign toggle
    this.LT1 = new B220Processor.FlipFlop(this, false);         // logical toggle 1
    this.LT2 = new B220Processor.FlipFlop(this, false);         // logical toggle 2
    this.LT3 = new B220Processor.FlipFlop(this, false);         // logical toggle 3
    this.SCI = new B220Processor.FlipFlop(this, false);         // sequence counter inverter
    this.SGT = new B220Processor.FlipFlop(this, false);         // sign toggle
    this.SUT = new B220Processor.FlipFlop(this, false);         // subtract toggle
    this.TBT = new B220Processor.FlipFlop(this, false);         // tape busy toggle
    this.TCT = new B220Processor.FlipFlop(this, false);         // tape clock toggle
    this.TPT = new B220Processor.FlipFlop(this, false);         // tape pulse toggle
    this.TWT = new B220Processor.FlipFlop(this, false);         // tape write toggle

    // Right-Hand Maintenance Panel Switches
    this.MULTIPLEACCESSSW = 0;
    this.V1V2V3COUNTSW = 0;
    this.AUDIBLEALARMSW = 0;
    this.PCOUNTSW = 0;
    this.DIGITCHECKSW = 0;
    this.ALARMSW = 0;
    this.ADCOUNTSW = 0;
    this.IDLEALARMSW = 0;
    this.FREQUENCYSELECTSW = 0;
    this.SINGLEPULSESW = 0;
    this.FETCHEXECUTELOCKSW = 0;

    // Right-Hand Maintenance Panel Registers & Flip-Flops
    this.AX = new B220Processor.Register(10, this, false);      // A exponent register
    this.BI = new B220Processor.Register( 8, this, false);      // paper tape buffer inverters
    this.DX = new B220Processor.Register( 8, this, false);      // D exponent register
    this.PA = new B220Processor.Register( 8, this, false);      // PA register

    this.ALT = new B220Processor.FlipFlop(this, false);         // program check alarm toggle
    this.AST = new B220Processor.FlipFlop(this, false);         // asynchronous toggle
    this.CCT = new B220Processor.FlipFlop(this, false);         // ?? toggle
    this.CRT = new B220Processor.FlipFlop(this, false);         // Cardatron alarm toggle
    this.DPT = new B220Processor.FlipFlop(this, false);         // decimal point toggle (SPO)
    this.EWT = new B220Processor.FlipFlop(this, false);         // end of word toggle
    this.EXT = new B220Processor.FlipFlop(this, false);         // fetch(0)/execute(1) toggle
    this.HAT = new B220Processor.FlipFlop(this, false);         // high-speed printer alarm toggle
    this.HCT = new B220Processor.FlipFlop(this, false);         // halt control toggle, for SOR, SOH, IOM
    this.HIT = new B220Processor.FlipFlop(this, false);         // high comparison toggle
    this.MAT = new B220Processor.FlipFlop(this, false);         // multiple access toggle
    this.MET = new B220Processor.FlipFlop(this, false);         // memory (storage) alarm toggle
    this.MNT = new B220Processor.FlipFlop(this, false);         // manual toggle
    this.OFT = new B220Processor.FlipFlop(this, false);         // overflow toggle
    this.PAT = new B220Processor.FlipFlop(this, false);         // paper tape alarm toggle
    this.PRT = new B220Processor.FlipFlop(this, false);         // paper tape read toggle
    this.PZT = new B220Processor.FlipFlop(this, false);         // paper tape zone toggle
    this.RPT = new B220Processor.FlipFlop(this, false);         // repeat toggle
    this.RUT = new B220Processor.FlipFlop(this, false);         // run toggle
    this.SST = new B220Processor.FlipFlop(this, false);         // single-step toggle
    this.TAT = new B220Processor.FlipFlop(this, false);         // magnetic tape alarm toggle
    this.UET = new B220Processor.FlipFlop(this, false);         // unequal comparison toggle (HIT=UET=0 => off)

    // Left/Right Maintenance Panel
    this.leftPanelOpen = false;
    this.rightPanelOpen = false;

    // Context-bound routines
    this.boundUpdateLampGlow = B220Processor.bindMethod(this, B220Processor.prototype.updateLampGlow);

    this.boundConsoleOutputSign = B220Processor.bindMethod(this, B220Processor.prototype.consoleOutputSign);
    this.boundConsoleOutputChar = B220Processor.bindMethod(this, B220Processor.prototype.consoleOutputChar);
    this.boundConsoleOutputFinished = B220Processor.bindMethod(this, B220Processor.prototype.consoleOutputFinished);
    this.boundConsoleInputReceiveChar = B220Processor.bindMethod(this, B220Processor.prototype.consoleInputReceiveChar);
    this.boundConsoleInputInitiateNormal = B220Processor.bindMethod(this, B220Processor.prototype.consoleInputInitiateNormal);
    this.boundConsoleInputInitiateInverse = B220Processor.bindMethod(this, B220Processor.prototype.consoleInputInitiateInverse);

    this.boundCardatronOutputWord= B220Processor.bindMethod(this, B220Processor.prototype.cardatronOutputWord);
    this.boundCardatronOutputFinished = B220Processor.bindMethod(this, B220Processor.prototype.cardatronOutputFinished);
    this.boundCardatronReceiveWord = B220Processor.bindMethod(this, B220Processor.prototype.cardatronReceiveWord);

    this.boundMagTapeComplete = B220Processor.bindMethod(this, B220Processor.prototype.magTapeComplete);
    this.boundMagTapeReceiveWord = B220Processor.bindMethod(this, B220Processor.prototype.magTapeReceiveWord);
    this.boundMagTapeSendWord = B220Processor.bindMethod(this, B220Processor.prototype.magTapeSendWord);

    this.clear();                       // Create and initialize the processor state

    this.loadDefaultProgram();          // Preload a default program
}


/***********************************************************************
*   Global Constants                                                   *
***********************************************************************/

B220Processor.version = "0.03b";

B220Processor.tick = 1000/200000;       // milliseconds per clock cycle (200KHz)
B220Processor.cyclesPerMilli = 1/B220Processor.tick;
                                        // clock cycles per millisecond (200 => 200KHz)
B220Processor.timeSlice = 10;           // maximum processor time slice, ms
B220Processor.delayAlpha = 0.001;       // decay factor for exponential weighted average delay
B220Processor.delayAlpha1 = 1-B220Processor.delayAlpha;
B220Processor.slackAlpha = 0.0001;      // decay factor for exponential weighted average slack
B220Processor.slackAlpha1 = 1-B220Processor.slackAlpha;

B220Processor.neonPersistence = 1000/60;
                                        // persistence of neon bulb glow [ms]
B220Processor.maxGlowTime = B220Processor.neonPersistence;
                                        // panel bulb glow persistence [ms]
B220Processor.lampGlowInterval = 50;    // background lamp sampling interval (ms)
B220Processor.adderGlowAlpha = B220Processor.neonPersistence/12;
                                        // adder and carry toggle glow decay factor,
                                        // based on one digit (1/12 word) time [ms]

B220Processor.pow2 = [ // powers of 2 from 0 to 52
                     0x1,              0x2,              0x4,              0x8,
                    0x10,             0x20,             0x40,             0x80,
                   0x100,            0x200,            0x400,            0x800,
                  0x1000,           0x2000,           0x4000,           0x8000,
                 0x10000,          0x20000,          0x40000,          0x80000,
                0x100000,         0x200000,         0x400000,         0x800000,
               0x1000000,        0x2000000,        0x4000000,        0x8000000,
              0x10000000,       0x20000000,       0x40000000,       0x80000000,
             0x100000000,      0x200000000,      0x400000000,      0x800000000,
            0x1000000000,     0x2000000000,     0x4000000000,     0x8000000000,
           0x10000000000,    0x20000000000,    0x40000000000,    0x80000000000,
          0x100000000000,   0x200000000000,   0x400000000000,   0x800000000000,
         0x1000000000000,  0x2000000000000,  0x4000000000000,  0x8000000000000,
        0x10000000000000];

B220Processor.mask2 = [ // (2**n)-1 for n from 0 to 52
                     0x0,              0x1,              0x3,              0x7,
                    0x0F,             0x1F,             0x3F,             0x7F,
                   0x0FF,            0x1FF,            0x3FF,            0x7FF,
                  0x0FFF,           0x1FFF,           0x3FFF,           0x7FFF,
                 0x0FFFF,          0x1FFFF,          0x3FFFF,          0x7FFFF,
                0x0FFFFF,         0x1FFFFF,         0x3FFFFF,         0x7FFFFF,
               0x0FFFFFF,        0x1FFFFFF,        0x3FFFFFF,        0x7FFFFFF,
              0x0FFFFFFF,       0x1FFFFFFF,       0x3FFFFFFF,       0x7FFFFFFF,
             0x0FFFFFFFF,      0x1FFFFFFFF,      0x3FFFFFFFF,      0x7FFFFFFFF,
            0x0FFFFFFFFF,     0x1FFFFFFFFF,     0x3FFFFFFFFF,     0x7FFFFFFFFF,
           0x0FFFFFFFFFF,    0x1FFFFFFFFFF,    0x3FFFFFFFFFF,    0x7FFFFFFFFFF,
          0x0FFFFFFFFFFF,   0x1FFFFFFFFFFF,   0x3FFFFFFFFFFF  , 0x7FFFFFFFFFFF,
         0x0FFFFFFFFFFFF,  0x1FFFFFFFFFFFF,  0x3FFFFFFFFFFFF,  0x7FFFFFFFFFFFF,
        0x0FFFFFFFFFFFFF] ;

B220Processor.multiplyDigitCounts = [1, 14, 27, 40, 53, 66, 65, 52, 39, 26];


/***********************************************************************
*   Utility Functions                                                  *
***********************************************************************/

/**************************************/
B220Processor.emptyFunction = function emptyFunction() {
    /* A function that does nothing, used for overriding object methods */

    return;
};

/**************************************/
B220Processor.bindMethod = function bindMethod(context, f) {
    /* Returns a new function that binds the function "f" to the object "context".
    Note that this is a static constructor property function, NOT an instance
    method of the CC object */

    return function bindMethodAnon() {return f.apply(context, arguments)};
};

/**************************************/
B220Processor.bcdBinary = function bcdBinary(v) {
    /* Converts the BCD value "v" to a binary number and returns it. If the
    BCD value is not decimal, returns NaN instead */
    var d;
    var power = 1;
    var result = 0;

    while(v) {
        d = v % 0x10;
        if (d > 9) {
            result = Number.NaN;
            break;
        } else {
            result += d*power;
            power *= 10;
            v = (v-d)/0x10;
        }
    }
    return result;
};

/**************************************/
B220Processor.binaryBCD = function binaryBCD(v) {
    /* Converts the binary value "v" to a BCD number and returns it */
    var d;
    var power = 1;
    var result = 0;

    while(v) {
        d = v % 10;
        result += d*power;
        power *= 0x10;
        v = (v-d)/10;
    }
    return result;
};


/***********************************************************************
*   Bit and Field Manipulation Functions                               *
***********************************************************************/

/**************************************/
B220Processor.bitTest = function bitTest(word, bit) {
    /* Extracts and returns the specified bit from the word */
    var p;                              // bottom portion of word power of 2

    if (bit > 0) {
        return ((word - word % (p = B220Processor.pow2[bit]))/p) % 2;
    } else {
        return word % 2;
    }
};

/**************************************/
B220Processor.bitSet = function bitSet(word, bit) {
    /* Sets the specified bit in word and returns the updated word */
    var ue = bit+1;                     // word upper power exponent
    var bpower =                        // bottom portion of word power of 2
        B220Processor.pow2[bit];
    var bottom =                        // unaffected bottom portion of word
        (bit <= 0 ? 0 : (word % bpower));
    var top =                           // unaffected top portion of word
        word - (word % B220Processor.pow2[ue]);

    return bpower + top + bottom;
};

/**************************************/
B220Processor.bitReset = function bitReset(word, bit) {
    /* Resets the specified bit in word and returns the updated word */
    var ue = bit+1;                     // word upper power exponent
    var bottom =                        // unaffected bottom portion of word
        (bit <= 0 ? 0 : (word % B220Processor.pow2[bit]));
    var top =                           // unaffected top portion of word
        word - (word % B220Processor.pow2[ue]);

    return top + bottom;
};

/**************************************/
B220Processor.bitFlip = function bitFlip(word, bit) {
    /* Complements the specified bit in word and returns the updated word */
    var ue = bit+1;                     // word upper power exponent
    var bpower =                        // bottom portion of word power of 2
        B220Processor.pow2[bit];
    var bottom =                        // unaffected bottom portion of word
        (bit <= 0 ? 0 : (word % bpower));
    var middle =                        // bottom portion of word starting with affected bit
        word % B220Processor.pow2[ue];
    var top = word - middle;            // unaffected top portion of word

    if (middle >= bpower) {             // if the affected bit is a one
        return top + bottom;                // return the result with it set to zero
    } else {                            // otherwise
        return bpower + top + bottom;       // return the result with it set to one
    }
};

/**************************************/
B220Processor.fieldIsolate = function fieldIsolate(word, start, width) {
    /* Extracts a bit field [start:width] from word and returns the field */
    var le = start-width+1;             // lower power exponent
    var p;                              // bottom portion of word power of 2

    return (le <= 0 ? word :
                      (word - word % (p = B220Processor.pow2[le]))/p
            ) % B220Processor.pow2[width];
};

/**************************************/
B220Processor.fieldInsert = function fieldInsert(word, start, width, value) {
    /* Inserts a bit field from the low-order bits of value ([48-width:width])
    into word.[start:width] and returns the updated word */
    var ue = start+1;                   // word upper power exponent
    var le = ue-width;                  // word lower power exponent
    var bpower =                        // bottom portion of word power of 2
        B220Processor.pow2[le];
    var bottom =                        // unaffected bottom portion of word
        (le <= 0 ? 0 : (word % bpower));
    var top =                           // unaffected top portion of word
        (ue <= 0 ? 0 : (word - (word % B220Processor.pow2[ue])));

    return (value % B220Processor.pow2[width])*bpower + top + bottom;
};

/**************************************/
B220Processor.fieldTransfer = function fieldTransfer(word, wstart, width, value, vstart) {
    /* Inserts a bit field from value.[vstart:width] into word.[wstart:width] and
    returns the updated word */
    var ue = wstart+1;                  // word upper power exponent
    var le = ue-width;                  // word lower power exponent
    var ve = vstart-width+1;            // value lower power exponent
    var vpower;                         // bottom port of value power of 2
    var bpower =                        // bottom portion of word power of 2
        B220Processor.pow2[le];
    var bottom =                        // unaffected bottom portion of word
        (le <= 0 ? 0 : (word % bpower));
    var top =                           // unaffected top portion of word
        (ue <= 0 ? 0 : (word - (word % B220Processor.pow2[ue])));

    return ((ve <= 0 ? value :
                       (value - value % (vpower = B220Processor.pow2[ve]))/vpower
                ) % B220Processor.pow2[width]
            )*bpower + top + bottom;
};


/***********************************************************************
*   System Clear & Lamp Glow Management                                *
***********************************************************************/

/**************************************/
B220Processor.prototype.clear = function clear() {
    /* Initializes (and if necessary, creates) the processor state */

    // Primary Registers
    this.A.set(0);
    this.B.set(0);
    this.C.set(0);
    this.D.set(0);
    this.E.set(0);
    this.P.set(0);
    this.R.set(0);
    this.S.set(0);
    this.IB.set(0);

    // Control Console Lamps
    this.digitCheckAlarm.set(0);

    this.systemNotReady.set(0);
    this.computerNotReady.set(0);

    this.compareLowLamp.set(0);
    this.compareEqualLamp.set(0);
    this.compareHighLamp.set(0);

    // Left-Hand Maintenance Panel Registers & Flip-Flops
    this.CI.set(0);
    this.DC.set(0);
    this.SC.set(0);
    this.SI.set(0);
    this.X.set(0);
    this.Y.set(0);
    this.Z.set(0);

    this.C10.set(0);
    this.DST.set(0);
    this.LT1.set(0);
    this.LT2.set(0);
    this.LT3.set(0);
    this.SCI.set(0);
    this.SGT.set(0);
    this.SUT.set(0);
    this.TBT.set(0);
    this.TCT.set(0);
    this.TPT.set(0);
    this.TWT.set(0);

    // Right-Hand Maintenance Panel Registers & Flip-Flops
    this.AX.set(0);
    this.BI.set(0);
    this.DX.set(0);
    this.PA.set(0);

    this.ALT.set(0);
    this.AST.set(0);
    this.CCT.set(0);
    this.CRT.set(0);
    this.DPT.set(0);
    this.EWT.set(0);
    this.EXT.set(this.FETCHEXECUTELOCKSW == 2 ? 1 : 0);
    this.HAT.set(0);
    this.HCT.set(0);
    this.HIT.set(0);
    this.MAT.set(0);
    this.MET.set(0);
    this.MNT.set(0);
    this.OFT.set(0);
    this.PAT.set(0);
    this.PRT.set(0);
    this.PZT.set(0);
    this.RPT.set(0);
    this.RUT.set(0);
    this.SST.set(0);
    this.TAT.set(0);
    this.UET.set(0);

    this.CCONTROL = 0;                  // copy of C register control digits (4 digits)
    this.COP = 0;                       // copy of C register op code (2 digits)
    this.CADDR = 0;                     // copy of C register operand address (4 digits)

    // I/O globals
    this.rDigit = 0;                    // variant/format digit from control part of instruction
    this.vDigit = 0;                    // variant digit from control part of instruction
    this.selectedUnit = 0;              // currently-selected unit number

    // Kill any pending action that may be in process
    if (this.scheduler) {
        clearCallback(this.scheduler);
        this.scheduler = 0;
    }

    this.updateGlow(1);                 // initialize the lamp states
};

/**************************************/
B220Processor.prototype.updateGlow = function updateGlow(beta) {
    /* Updates the lamp glow for all registers and flip-flops in the
    system. Beta is a bias in the range (0,1). For normal update use 0;
    to freeze the current state in the lamps use 1 */
    var gamma = (this.RUT.value ? beta || 0 : 1);

    // Primary Registers
    this.A.updateGlow(gamma);
    this.B.updateGlow(gamma);
    this.C.updateGlow(gamma);
    this.D.updateGlow(gamma);
    this.E.updateGlow(gamma);
    this.P.updateGlow(gamma);
    this.R.updateGlow(gamma);
    this.S.updateGlow(gamma);
    this.IB.updateGlow(gamma);

    // Control Console Lamps
    this.digitCheckAlarm.updateGlow(gamma);

    this.systemNotReady.updateGlow(gamma);
    this.computerNotReady.updateGlow(gamma);

    this.compareLowLamp.updateGlow(gamma);
    this.compareEqualLamp.updateGlow(gamma);
    this.compareHighLamp.updateGlow(gamma);

    // Left-Hand Maintenance Panel Registers & Flip-Flops
    if (this.leftPanelOpen) {
        this.CI.updateGlow(gamma);
        this.DC.updateGlow(gamma);
        this.SC.updateGlow(gamma);
        this.SI.updateGlow(gamma);
        this.X.updateGlow(gamma);
        this.Y.updateGlow(gamma);
        this.Z.updateGlow(gamma);

        this.C10.updateGlow(gamma);
        this.DST.updateGlow(gamma);
        this.LT1.updateGlow(gamma);
        this.LT2.updateGlow(gamma);
        this.LT3.updateGlow(gamma);
        this.SCI.updateGlow(gamma);
        this.SGT.updateGlow(gamma);
        this.SUT.updateGlow(gamma);
        this.TBT.updateGlow(gamma);
        this.TCT.updateGlow(gamma);
        this.TPT.updateGlow(gamma);
        this.TWT.updateGlow(gamma);
    }

    // Right-Hand Maintenance Panel Registers & Flip-Flops
    this.ALT.updateGlow(gamma);
    this.MET.updateGlow(gamma);
    this.TAT.updateGlow(gamma);
    this.PAT.updateGlow(gamma);
    this.CRT.updateGlow(gamma);
    this.HAT.updateGlow(gamma);

    this.EXT.updateGlow(gamma);
    this.OFT.updateGlow(gamma);
    this.RPT.updateGlow(gamma);
    this.RUT.updateGlow(gamma);

    if (this.rightPanelOpen) {
        this.AX.updateGlow(gamma);
        this.BI.updateGlow(gamma);
        this.DX.updateGlow(gamma);
        this.PA.updateGlow(gamma);

        this.AST.updateGlow(gamma);
        this.CCT.updateGlow(gamma);
        this.CRT.updateGlow(gamma);
        this.DPT.updateGlow(gamma);
        this.EWT.updateGlow(gamma);
        this.HCT.updateGlow(gamma);
        this.HIT.updateGlow(gamma);
        this.MAT.updateGlow(gamma);
        this.MNT.updateGlow(gamma);
        this.PRT.updateGlow(gamma);
        this.PZT.updateGlow(gamma);
        this.SST.updateGlow(gamma);
        this.UET.updateGlow(gamma);
    }
};

/**************************************/
B220Processor.prototype.clockIn = function clockIn() {
    /* Updates the emulated processor clock during asynchronous I/O so that
    glow averages can be updated based on elapsed time. Also used at the end of
    and I/O to synchronize the emulated clock with real time */

    this.execClock = performance.now();
};


/***********************************************************************
*   Generic Register Class                                             *
***********************************************************************/

B220Processor.Register = function Register(bits, p, invisible) {
    /* Constructor for the generic Register class. Defines a binary register
    of "bits" bits. "p" is a reference to the Processor object, used to access
    the timing members. "invisible" should be true if the register does not
    have a visible presence in the UI -- this will inhibit computing average
    lamp glow values for the register.
    Note that it is important to increment this.execClock in the caller AFTER
    setting new values in registers and flip-flops. This allows the average
    intensity to be computed based on the amount of time a bit was actually in
    that state */

    this.bits = bits;                   // number of bits in register
    this.visible = (invisible ? false : true);
    this.lastExecClock = 0;             // time register was last set
    this.p = p;                         // processor instance
    this.value = 0;                     // binary value of register: read-only externally

    this.glow = new Float64Array(bits); // average lamp glow values
};

/**************************************/
B220Processor.Register.prototype.checkFC = function checkFC() {
    /* Checks the register for a Forbidden Combination (hex A-F) digit. If at
    least one exists, sets the Digit Check alarm and returns true. The bit mask
    operations are done 28 bits at a time to avoid problems with the 32-bit
    2s-complement arithmetic used by Javascript for bit operations */
    var v1 = this.value;                // high-order digits (eventually)
    var v2 = v1%0x10000000;             // low-order 7 digits

    v1 = (v1-v2)/0x10000000;

    if (((v2 & 0x8888888) >>> 3) & (((v2 & 0x4444444) >>> 2) | ((v2 & 0x2222222) >>> 1))) {
        this.p.setDigitCheck(1);
        return 1;
    } else if (v1 <= 9) {
        return 0;
    } else if (((v1 & 0x8888888) >>> 3) & (((v1 & 0x4444444) >>> 2) | ((v1 & 0x2222222) >>> 1))) {
        this.p.setDigitCheck(1);
        return 1;
    } else {
        return 0;
    }

};

/**************************************/
B220Processor.Register.prototype.updateGlow = function updateGlow(beta) {
    /* Updates the lamp glow averages based on this.p.execClock. Note that the
    glow is always aged by at least one clock tick. Beta is a bias in the
    range (0,1). For normal update, use 0; to freeze the current state, use 1 */
    var alpha = Math.min(Math.max(this.p.execClock-this.lastExecClock, B220Processor.tick)/
                         B220Processor.maxGlowTime + beta, 1.0);
    var alpha1 = 1.0-alpha;
    var b = 0;
    var bit;
    var v = this.value;

    if (this.visible) {
        while (v) {
            bit = v % 2;
            v = (v-bit)/2;
            this.glow[b] = this.glow[b]*alpha1 + bit*alpha;
            ++b;
        }

        while (b < this.bits) {
            this.glow[b] *= alpha1;
            ++b;
        }
    }

    this.lastExecClock = this.p.execClock;
};

/**************************************/
B220Processor.Register.prototype.set = function set(value) {
    /* Set a binary value into the register. Use this rather than setting
    the value member directly so that average lamp glow can be computed.
    Returns the new value */

    this.value = value;
    if (this.visible) {
       this.updateGlow(0);
    }

    if (value > 9) {
        this.checkFC();
    }
    return value;
};

/**************************************/
B220Processor.Register.prototype.getDigit = function getDigit(digitNr) {
    /* Returns the value of a 4-bit digit in the register. Digits are numbered
    from 0 starting at the low end (not the way the 220 numbers them) */

    return B220Processor.fieldIsolate(this.value, digitNr*4+3, 4);
};
/**************************************/
B220Processor.Register.prototype.setDigit = function setDigit(digitNr, value) {
    /* Sets the value of a 4-bit digit in the register. Digits are numbered
    from 0 starting at the low end (not the way the 220 numbers them) */

    return this.set(B220Processor.fieldInsert(this.value, digitNr*4+3, 4, value));
};

/**************************************/
B220Processor.Register.prototype.getBit = function getBit(bitNr) {
    /* Returns the value of a bit in the register */

    return (bitNr < this.bits ? B220Processor.bitTest(this.value, bitNr) : 0);
};

/**************************************/
B220Processor.Register.prototype.setBit = function setBit(bitNr, value) {
    /* Set a bit on or off in the register. Returns the new register value.
    Note that the glow is always aged by at least one clock tick */
    var alpha = Math.min(Math.max(this.p.execClock-this.lastExecClock, B220Processor.tick)/
                         B220Processor.maxGlowTime, 1.0);
    var bit = (value ? 1 : 0);

    if (bitNr < this.bits) {
        // Update the lamp glow for the former state.
        if (this.visible) {
            this.glow[bitNr] = this.glow[bitNr]*(1.0-alpha) + bit*alpha;
        }

        // Set the new state.
        this.value = (bit ? B220Processor.bitSet(this.value, bitNr) : B220Processor.bitReset(this.value, bitNr));
    }

    this.checkFC();
    return this.value;
};

/**************************************/
B220Processor.Register.prototype.flipBit = function flipBit(bitNr) {
    /* Complements a bit in the register. Returns the new register value. Note
    that the glow is always aged by at least one clock tick */
    var alpha = Math.min(Math.max(this.p.execClock-this.lastExecClock, B220Processor.tick)/
                B220Processor.maxGlowTime, 1.0);
    var bit;

    if (bitNr < this.bits) {
        bit = 1 - B220Processor.bitTest(this.value, bitNr);

        // Update the lamp glow for the former state.
        if (this.visible) {
            this.glow[bitNr] = this.glow[bitNr]*(1.0-alpha) + bit*alpha;
        }

        // Set the new state.
        this.value = B220Processor.bitFlip(this.value, bitNr);
    }

    this.checkFC();
    return this.value;
};

/**************************************/
B220Processor.Register.prototype.add = function add(addend) {
    /* Adds "addend" to the current register value without regard to sign,
    discarding any overflow beyond the number of bits defined for the register.
    Returns the new register value. NOTE THAT THE ADDEND IS IN BCD, NOT BINARY.
    Also note that this uses the 220 adder, so generally do not use this for
    simple increment of address and counter registers -- use .inc() instead */
    var digits = (this.bits+3) >> 2;

    return this.set(this.p.bcdAdd(this.value, addend, digits) %
                    B220Processor.pow2[this.bits]);
};

/**************************************/
B220Processor.Register.prototype.sub = function sub(subtrahend) {
    /* Subtracts "subtrahend" from the current register value without regard to
    sign, discarding any overflow beyond the number of bits defined for the register.
    Returns the new register value. NOTE THAT THE ADDEND IS IN BCD, NOT BINARY.
    Also note that this uses the 220 adder, so generally do not use this for
    simple decrement of address and counter registers -- use .dec() instead */
    var digits = (this.bits+3) >> 2;

    return this.set(this.p.bcdAdd(subtrahend, this.value, digits, 1, 1) %
                    B220Processor.pow2[this.bits]);
};

/**************************************/
B220Processor.Register.prototype.inc = function inc() {
    /* Increments the register by 1 using BCD arithmetic and returns the new
    register value. This method does not use the 220 adder, so is safe to use
    for incrementing address and counter registers during instructions. Any
    overflow is discarded and the register wraps around to zero */
    var d = this.value%0x10;            // current low-order digit
    var maxPower = B220Processor.pow2[this.bits];
    var power = 1;                      // factor for current digit position
    var w = this.value;                 // working copy of register value

    while (d == 9 && power < maxPower) {// while a carry would be generated
        this.value -= 9*power;          // change this digit to a zero
        power *= 0x10;                  // bump power for next digit
        w = (w-d)/0x10;                 // shift working copy down
        d = w%0x10;                     // isolate the next digit
    }

    if (d < 9) {
        this.value += power;            // increment the first digit that will not generate carry
    }
    return this.set(this.value % B220Processor.pow2[this.bits]);
};

/**************************************/
B220Processor.Register.prototype.dec = function dec() {
    /* Decrements the register by 1 using BCD arithmetic and returns the new
    register value. This method does not use the 220 adder, so is safe to use
    for decrementing address and counter registers during instructions. Any
    underflow is discarded and the register wraps around to all-nines */
    var d = this.value%0x10;            // current low-order digit
    var maxPower = B220Processor.pow2[this.bits];
    var power = 1;                      // factor for current digit position
    var w = this.value;                 // working copy of register value

    while (d == 0 && power < maxPower) {// while a borrow would be generated
        this.value += 9*power;          // change this digit to a 9
        power *= 0x10;                  // bump power for next digit
        w = (w-d)/0x10;                 // shift working copy down
        d = w%0x10;                     // isolate the next digit
    }

    if (d > 0) {
        this.value -= power;            // decrement the first digit that will not generate a borrow
    }
    return this.set(this.value % maxPower);
};


/***********************************************************************
*   Generic Flip-Flop Class                                            *
***********************************************************************/

B220Processor.FlipFlop = function FlopFlop(p, invisible) {
    /* Constructor for the generaic FlipFlop class. "p" is a reference to the
    Processor object, used to access the timing members. "invisible" should be
    true if the FF does not have a visible presence in the UI -- this will
    inhibit computing the average lamp glow value for it.
    Note that it is important to increment this.execClock in the caller AFTER
    setting new values in registers and flip-flops. This allows the average
    intensity to be computed based on the amount of time a bit was actually in
    that state */

    this.visible = (invisible ? false : true);
    this.lastExecClock = 0;             // time register was last set
    this.p = p;                         // processor instance
    this.value = 0;                     // binary value of register: read-only externally
    this.glow = 0;                      // average lamp glow value
};

/**************************************/
B220Processor.FlipFlop.prototype.updateGlow = function updateGlow(beta) {
    /* Updates the average glow for the flip flop. Note that the glow is
    always aged by at least one clock tick. Beta is a bias in the
    range (0,1). For normal update, use 0; to freeze the current state, use 1.
    Returns the new average */
    var alpha = Math.min(Math.max(this.p.execClock-this.lastExecClock, B220Processor.tick)/
                         B220Processor.maxGlowTime + beta, 1.0);

    if (this.visible) {
        this.glow = this.glow*(1.0-alpha) + this.value*alpha;
    }

    this.lastExecClock = this.p.execClock;
    return this.glow;
};

/**************************************/
B220Processor.FlipFlop.prototype.set = function set(value) {
    /* Set the value of the FF. Use this rather than setting the value member
    directly so that average lamp glow can be computed. Returns the new value */

    this.value = (value ? 1 : 0);
    if (this.visible) {
        this.updateGlow(0);
    }

    return value;
};

/**************************************/
B220Processor.FlipFlop.prototype.flip = function flip() {
    /* Complement the value of the FF. Returns the new value */

    return this.set(1-this.value);
};


/***********************************************************************
*   System Alarms                                                      *
***********************************************************************/

/**************************************/
B220Processor.prototype.setDigitCheck = function setDigitCheck(value) {
    /* Sets the Digit Check alarm */

    if (!this.ALARMSW && !this.DIGITCHECKSW) {
        this.digitCheckAlarm.set(value);
        if (value) {
            this.setStop();
            this.SST.set(1);            // stop at end of current cycle
        }
    }
};

/**************************************/
B220Processor.prototype.setProgramCheck = function setProgramCheck(value) {
    /* Sets the Program Check alarm */

    if (!this.ALARMSW) {
        this.ALT.set(value);
        if (value) {
            this.setStop();
        }
    }
};

/**************************************/
B220Processor.prototype.setStorageCheck = function setStorageCheck(value) {
    /* Sets the Storage Check alarm */

    if (!this.ALARMSW) {
        this.MET.set(value);
        if (value) {
            this.setStop();
            this.SST.set(1);            // stop at end of current cycle
        }
    }
};

/**************************************/
B220Processor.prototype.setMagneticTapeCheck = function setMagneticTapeCheck(value) {
    /* Sets the Magnetic Tape Check alarm */

    if (!this.ALARMSW) {
        this.TAT.set(value);
        if (value) {
            this.setStop();
        }
    }
};

/**************************************/
B220Processor.prototype.setCardatronCheck = function setCardatronCheck(value) {
    /* Sets the Cardatron Check alarm */

    if (!this.ALARMSW) {
        this.CRT.set(value);
        if (value) {
            this.setStop();
        }
    }
};

/**************************************/
B220Processor.prototype.setPaperTapeCheck = function setPaperTapeCheck(value) {
    /* Sets the Paper Tape Check alarm */

    if (!this.ALARMSW) {
        this.PAT.set(value);
        if (value) {
            this.setStop();
        }
    }
};

/**************************************/
B220Processor.prototype.setHighSpeedPrinterCheck = function setHighSpeedPrinterCheck(value) {
    /* Sets the High Speed Printer Check alarm */

    if (!this.ALARMSW) {
        this.HAT.set(value);
        if (value) {
            this.setStop();
        }
    }
};


/***********************************************************************
*   Memory Access                                                      *
***********************************************************************/

/**************************************/
B220Processor.prototype.readMemory = function readMemory() {
    /* Reads the contents of one word of memory into the IB register from the
    address in the E register. Sets the Storage Check alarm if the address is
    not valid. Returns the word fetched, or the current value of IB if invalid
    address */
    var addr = B220Processor.bcdBinary(this.E.value);

    if (isNaN(addr)) {
        this.setStorageCheck(1);
        return this.IB.value;
    } else if (addr >= this.memorySize) {
        this.setStorageCheck(1);
        return this.IB.value;
    } else if (this.MEMORYLOCKOUTSW) {
        return this.IB.set(this.D.value);
    } else {
        return this.IB.set(this.MM[addr]);
    }
};

/**************************************/
B220Processor.prototype.writeMemory = function writeMemory() {
    /* Stores one word of memory from the IB register to the address in the E
    register. Sets the Storage Check alarm if the address is not valid */
    var addr = B220Processor.bcdBinary(this.E.value);

    if (isNaN(addr)) {
        this.setStorageCheck(1);
    } else if (addr >= this.memorySize) {
        this.setStorageCheck(1);
    } else if (this.MEMORYLOCKOUTSW) {
        this.D.set(this.IB.value);
    } else {
        this.MM[addr] = this.IB.value;
    }
};


/***********************************************************************
*   The 220 Adder and Arithmetic Operations                            *
***********************************************************************/

/**************************************/
B220Processor.prototype.bcdAdd = function bcdAdd(a, d, digits, complement, initialCarry) {
    /* Returns an unsigned, BCD addition of "a" and "d", producing "digits" of
    BCD result. Any higher-order digits and any overflow are discarded. Maximum
    capacity in Javascript (using IEEE 64-bit floating point) is 14 digits.
    On input, "complement" indicates whether 9s-complement addition should be
    performed; "initialCarry" indicates whether an initial carry of 1 should be
    applied to the adder. On output, this.CI is set from the final carry toggles
    of the addition and this.C10 will have the carry toggle. Further, this.Z
    will still have a copy of the sign (high-order) digit. Sets the Program
    Check alarm if non-decimal digits are encountered, but does not set the
    Overflow toggle */
    var ad;                             // current augend (a) digit;
    var adder;                          // local copy of adder digit
    var am = a % B220Processor.pow2[digits*4]; // augend mantissa
    var carry = (initialCarry || 0) & 1;// local copy of carry toggle (CI1, CAT)
    var compl = complement || 0;        // local copy of complement toggle
    var ct = carry;                     // local copy of carry register (CI1-16)
    var dd;                             // current addend (d) digit;
    var dm = d % B220Processor.pow2[digits*4]; // addend mantissa
    var shiftPower = B220Processor.pow2[(digits-1)*4]; // to position high-order digit
    var x;                              // digit counter

    // Loop through the digits
    for (x=0; x<digits; ++x) {
        // shift low-order augend digit right into the adder
        ad = am % 0x10;
        am = (am - ad)/0x10;
        this.X.set(ad);                 // tests for FC
        if (compl) {
            ad = 9-ad;
        }

        // Add the digits plus carry, complementing as necessary
        dd = dm % 0x10;
        this.Y.set(dd);                 // tests for FC

        adder = ad + dd + carry;

        // Decimal-correct the adder
        if (adder < 10) {
            carry = 0;
        } else {
            adder -= 10;
            carry = 1;
        }

        // Compute the carry toggle register (just for display)
        ct = (((ad & dd) | (ad & ct) | (dd & ct)) << 1) + carry;

        // Update the visible registers (for display only)
        this.Z.set(adder);              // tests for FC
        this.C10.set(carry);
        this.CI.set(ct);
        this.SI.set(0x0F ^ ct);         // just a guess as to the sum inverters

        // rotate the adder into the high-order digit
        am += adder*shiftPower;
        // shift the addend right to the next digit
        dm = (dm - dd)/0x10;
    } // for x

    return am;
};

/**************************************/
B220Processor.prototype.integerAdd = function integerAdd(absolute, toD) {
    /* After accessing memory, algebraically add the addend (IB) to the augend (A).
    If "absolute" is true, then the sign of the word from memory is forced to zero.
    If "toD" is false, the result will be left in A, and D will contain a copy
    of the word from memory with the three high-order bits of its sign set to
    zero. If "toD" is true, the result will be left in D, and A will not be
    altered, except than the three high-order bits of its sign digit will be
    set to zero. Note that if the value of the result is zero, its sign will be
    the original sign of A. All values are BCD with the sign in the 11th digit
    position. Sets the Overflow and Digit Check alarms as necessary */
    var am = this.A.value % 0x10000000000;      // augend mantissa
    var aSign = ((this.A.value - am)/0x10000000000)%2;
    var compl;                                  // complement addition required
    var dm;                                     // addend mantissa
    var dSign;                                  // addend sign
    var sign;                                   // local copy of sign toggle
    var timing = 0.095;

    this.E.set(this.CADDR);
    this.readMemory();
    if (this.MET.value) {               // invalid address
        this.A.set(am);                 // sign is zero
        return;                         // exit to Operation Complete
    }

    dm = this.IB.value % 0x10000000000;
    dSign = ((this.IB.value - dm)/0x10000000000)%2;
    sign = (absolute ? 0 : dSign);
    if (this.SUT.value) {
        sign = 1-sign;                  // complement sign for subtraction
    }

    compl = (aSign^sign);
    am = this.bcdAdd(am, dm, 11, compl, compl);

    // Now examine the resulting sign (still in the adder) to see if we have overflow
    // or need to recomplement the result
    switch (this.Z.value) {
    case 0:
        am += sign*0x10000000000;
        break;
    case 1:
        am += (sign-1)*0x10000000000;
        this.OFT.set(1);
        break;
    default: // sign is 9
        // reverse the sign toggle and recomplement the result (virtually adding to the zeroed dm)
        sign = 1-sign;
        am = this.bcdAdd(am, 0, 11, 1, 1);
        // after recomplementing, set the correct sign (adder still contains sign of result)
        am += (sign - this.Z.value)*0x10000000000;
        timing += 0.060;
        break;
    } // switch this.Z.value

    if (am%0x10000000000 == 0) {
        am = aSign*0x10000000000;
    }

    // Set toggles for display purposes and return the result
    this.DST.set(dSign);
    this.SGT.set(sign);
    if (toD) {
        this.D.set(am);
        this.A.set(this.A.value%0x20000000000);
    } else {
        this.D.set(dSign*0x10000000000 + dm);
        this.A.set(am);
    }

    this.opTime = timing;
};

/**************************************/
B220Processor.prototype.integerExtract = function integerExtract() {
    /* "Extract" digits from A according to the digit pattern in IB.
    If a pattern digit is even, then the corresponding digit in the value is
    set to zero. If the pattern digit is odd, then the corresponding value
    digit is not changed. Overflow is not possible, but a Digit Check
    alarm can occur */
    var ad;                             // current value (A) digit;
    var am = this.A.value;              // value mantissa
    var dd;                             // current pattern (D) digit;
    var dm;                             // pattern mantissa
    var x;                              // digit counter

    this.E.set(this.CADDR);
    this.readMemory();
    if (this.MET.value) {               // invalid address
        return;                         // exit to Operation Complete
    }

    // Loop through the 11 digits including signs (which were set to zero in am and dm)
    var dm = this.IB.value;
    for (x=0; x<11; ++x) {
        // shift low-order value digit right into the adder
        ad = am % 0x10;
        am = (am - ad)/0x10;
        this.X.set(ad);                 // tests for FC

        // shift low-order pattern digit into the adder
        dd = dm % 0x10;
        dm = (dm - dd)/0x10;
        this.Y.set(dd);                 // tests for FC

        if (dd%2) {                     // if extract digit is odd
            this.Z.set(ad);             // keep the value digit
        } else {                        // otherwise, if it's even
            ad = 0;                     // clear the value digit
            this.Z.set(0);
        }

        // rotate the digit into the result
        am += ad*0x10000000000;
    } // for x

    // Set toggles for display purposes and return the result
    this.A.set(am);
    this.D.set(this.IB.value);
    this.opTime = 0.145;
};

/**************************************/
B220Processor.prototype.integerMultiply = function integerMultiply() {
    /* Algebraically multiply the multiplicand (IB) by the multiplier (A), producing
    a 20-digit product in A and R. Final sign of R will be final sign of A. All
    values are BCD with the sign in the 11th digit position. Sets Forbidden-
    Combination stop as necessary. Overflow is not possible */
    var ad;                             // current product (A) digit;
    var am = this.A.value % 0x10000000000;      // product (A) mantissa
    var aSign = ((this.A.value - am)/0x10000000000)%2;
    var count = 0;                      // count of multiply cycles
    var dm;                             // multiplicand mantissa
    var dSign;                          // sign of multiplicand
    var rc;                             // dup of rd for add counting
    var rd;                             // current multipler (R) digit;
    var rm = am;                        // current multiplier (R) mantissa
    var sign;                           // local copy of sign toggle (sign of product)
    var x;                              // digit counter

    this.SUT.set(0);
    this.E.set(this.CADDR);
    this.readMemory();
    if (this.MET.value) {               // invalid address
        this.A.set(am);                 // sign is zero
        this.R.set(0);
        return;                         // exit to Operation Complete
    }

    dm = this.IB.value % 0x10000000000;
    dSign = ((this.IB.value - dm)/0x10000000000)%2;
    sign = aSign ^ dSign;
    am = 0;                             // clear the local product (A) mantissa

    // We now have the multiplicand in D (dm), the multiplier in R (rm), and an
    // initial product of zero in A (am). Go through a classic multiply cycle,
    // doing repeated addition based on each multipler digit, and between digits
    // shifting the product (in am and rm) one place to the right. After 10 digits,
    // we're done. The 220 probably did a combination of addition and subtraction,
    // depending on whether the current multiplier digit was >5, to minimize the
    // number of addition cycles. We don't care how long this takes internally,
    // the the following mechanization uses the simple way.

    for (x=0; x<10; ++x) {
        rd = rm % 0x10;
        count += B220Processor.multiplyDigitCounts[rd];
        for (rc=rd; rc>0; --rc) {   // repeated addition
            am = this.bcdAdd(am, dm, 11, 0, 0);
        }

        ad = am % 0x10;
        am = (am-ad)/0x10;
        rm = (rm-rd)/0x10 + ad*0x1000000000;
    } // for x

    this.DST.set(dSign);
    this.SGT.set(sign);
    this.A.set(sign*0x10000000000 + am);
    this.R.set(sign*0x10000000000 + rm);
    this.D.set(dSign*0x10000000000 + dm);
    this.opTime = 0.090 + 0.005*count;
};

/**************************************/
B220Processor.prototype.integerDivide = function integerDivide() {
    /* Algebraically divide the dividend (A & R) by the divisor (IB), producing
    a signed 10-digit quotient in A and the remainder in R. All values are BCD
    with the sign in the 11th digit position. Sets Digit Check alarm
    as necessary. If the magnitude of the divisor (IB) is less or equal to the
    magnitude of the dividend (A), Overflow is set and division terminates */
    var am = this.A.value % 0x10000000000;      // current remainder (A) mantissa
    var aSign = ((this.A.value - am)/0x10000000000)%2;
    var count = 0;                      // count of divide cycles
    var dm;                             // divisor mantissa
    var dSign;                          // sign of divisior
    var rd;                             // current quotient (R) digit;
    var rm = this.R.value%0x10000000000;// current quotient (R) mantissa (ignore sign)
    var sign;                           // local copy of sign toggle (sign of quotient)
    var tSign = 1;                      // sign for timing count accumulation
    var x;                              // digit counter

    this.E.set(this.CADDR);
    this.readMemory();
    if (this.MET.value) {               // invalid address
        this.A.set(am);                 // sign is zero
        this.R.set(aSign*0x10000000000 + rm);
        return;                         // exit to Operation Complete
    }

    dm = this.IB.value % 0x10000000000;
    dSign = ((this.IB.value - dm)/0x10000000000)%2;
    sign = aSign ^ dSign;
    this.DST.set(dSign);
    this.SGT.set(sign);
    this.SUT.set(1);

    // We now have the divisor in D (dm) and the dividend in A (am) & R (rm).
    // The value in am will become the remainder; the value in rm will become
    // the quotient. Go through a classic long-division cycle, repeatedly
    // subtracting the divisor from the dividend, counting subtractions until
    // underflow occurs, and shifting the divisor left one digit.

    // The 220 probably did not work quite the way that it has been mechanized
    // below, which is close to the way the 205 worked. The funny way that timing
    // for division could be calculated from the differences of alternate quotient
    // digits (see the Operational Characteristics manual, 5020A, August 1960, p.212)
    // suggests that something clever was going on with the 220 divide implementation.

    if (this.bcdAdd(dm, am, 11, 1, 1) < 0x10000000000) {
        this.OFT.set(1);
        this.A.set(aSign*0x10000000000 + am);
        this.R.set(aSign*0x10000000000 + rm);
        this.D.set(this.IB.value);
        this.opTime = 0.090;
    } else {
        for (x=0; x<10; ++x) {
            // First, shift A & R to the left one digit, with A1 shifting to ASGN
            rd = (rm - rm%0x1000000000)/0x1000000000;
            rm = (rm%0x1000000000)*0x10;
            am = am*0x10 + rd;

            // Now repeatedly subtract D from A until we would get underflow.
            rd = 0;
            while (am >= dm) {
                am = this.bcdAdd(dm, am, 11, 1, 1);
                ++rd;
                count += tSign;
            }

            rm += rd;                   // move digit into quotient
            tSign = -tSign;
        } // for x

        this.A.set(sign*0x10000000000 + rm);    // rotate final values in A & R
        this.R.set(sign*0x10000000000 + am);
        this.D.set(dSign*0x10000000000 + dm);
        this.opTime = 3.805 + 0.060*count;
    }
};

/**************************************/
B220Processor.prototype.floatingAdd = function floatingAdd(absolute) {
    /* Algebraically add the floating-point addend (IB) to the floating-point
    augend (A), placing the result in A and clearing D. The R register is not
    affected. All values are BCD with the sign in the 11th digit position.
    The floating exponent is in the first two digit positions, biased by 50.
    Sets Overflow and the Digit Check alarm as necessary */
    var ax;                             // augend exponent (binary)
    var am = this.A.value % 0x10000000000;    // augend mantissa (BCD)
    var aSign = ((this.A.value - am)/0x10000000000)%2;
    var compl;                          // complement addition required
    var d;                              // scratch digit;
    var dx;                             // addend exponent (binary)
    var dm;                             // addend mantissa (BCD)
    var dSign;                          // addend sign
    var limiter = (this.CCONTROL - this.CCONTROL%0x1000)/0x1000; // normalizing limiter
    var shifts = 0;                     // number of scaling/normalization shifts done
    var sign;                           // local copy of sign toggle
    var timing = 0.125;                 // minimum instruction timing

    this.E.set(this.CADDR);
    this.readMemory();
    if (this.MET.value) {               // invalid address
        return;                         // exit to Operation Complete
    }

    dm = this.IB.value % 0x10000000000;
    dSign = ((this.IB.value - dm)/0x10000000000)%2;
    sign = (absolute ? 0 : dSign);
    if (this.SUT.value) {
        sign = 1-sign;                  // complement sign for subtraction
    }

    ax = (am - am%0x100000000)/0x100000000;
    am %= 0x100000000;
    dx = (dm - dm%0x100000000)/0x100000000;
    dm %= 0x100000000;

    // If the exponents are unequal, scale the smaller
    // until they are in alignment, or one mantissa becomes zero.
    if (ax > dx) {
        // Scale D until its exponent matches or the mantissa goes to zero.
        while (ax > dx) {
            if (++shifts < 8) {
                timing += 0.010;
                dx = this.bcdAdd(1, dx, 2, 0, 0);  // ++dx
                d = dm % 0x10;
                dm = (dm - d)/0x10;     // shift right
            } else {
                sign = aSign;           // result is value in A
                dm = dSign = limiter = 0;
                dx = 0x10;
                break;
            }
        }
    } else if (ax < dx) {
        // Scale A until its exponent matches or the mantissa goes to zero.
        while (ax < dx) {
            if (++shifts < 8) {
                timing += 0.010;
                ax = this.bcdAdd(1, ax, 3, 0, 0);  // ++ax
                d = am % 0x10;
                am = (am - d)/0x10;     // shift right
            } else {
                am = dm;                // result is value in D with adjusted sign
                ax = dx;
                dm = dSign = limiter = 0;
                dx = 0x10;
                break;
            }
        }
    }

    if (am && dm) {                     // both mantissas are non-zero
        compl = (aSign^sign);
        am = this.bcdAdd(am, dm, 11, compl, compl);
        dm = dSign = 0;
        dx = 0x10;

        // Now examine the resulting sign (still in the adder) to see if we
        // need to recomplement the result.
        if (this.Z.value) {
            // Reverse the sign toggle and recomplement the result.
            sign = 1-sign;
            am = this.bcdAdd(am, 0, 11, 1, 1);
            timing += 0.060;
        }

        // Normalize or scale the result as necessary
        if (am >= 0x100000000) {
            // Mantissa overflow: add/subtract can produce at most one digit of
            // overflow, so shift right and increment the exponent, checking for
            // overflow in the exponent.
            limiter = 0;
            if (ax < 0x99) {
                timing += 0.005;
                ax = this.bcdAdd(1, ax, 3, 0, 0);  // ++ax
                d = am % 0x10;
                am = (am - d)/0x10;     // shift right
            } else {
                // A scaling shift would overflow the exponent, so set the overflow
                // toggle and leave the mantissa as it was from the add, without the
                // exponent inserted back into it. Since the A register gets reassembled
                // below, we need to set up the mantissa and exponent so the reconstruct
                // will effectively do nothing.
                this.OFT.set(1);
                sign = ax = dx = limiter = 0;
            }
        } else if (am == 0) {           // mantissa is zero
            ax = sign = limiter = 0;
            timing += 0.065;
        } else {                        // normalize the result as necessary
            shifts = 0;
            while (am < 0x10000000) {
                if (ax > 0) {
                    ++shifts;
                    timing += 0.010;
                    ax = this.bcdAdd(1, ax, 3, 1, 1);  // --ax
                    am *= 0x10;         // shift left
                } else {
                    // Exponent underflow: set the reconstructed A to zero.
                    am = ax = sign = 0;
                    break;
                }
            }

            // Determine whether normalizing shifts exceed the limiter value
            if (limiter > 0) {
                if (limiter >= 8) {
                    limiter = 0;
                } else if (shifts > limiter) {
                    limiter = 10 - (shifts-limiter);
                    this.setStop();
                } else {
                    limiter = 0;
                }
            }
        }
    }

    // Rebuild the C register with the final normalization limiter
    this.CCONTROL = this.CCONTROL%0x1000 + limiter*0x1000;
    this.C.set((this.CCONTROL*0x100 + this.COP)*0x10000 + this.CADDR);

    // Set toggles for display purposes and set the result.
    this.AX.set(ax);
    this.DX.set(dx);
    this.DST.set(dSign);
    this.SGT.set(sign);
    this.A.set((sign*0x100 + ax)*0x100000000 + am);
    this.D.set((dSign*0x100 + dx)*0x100000000 + dm);
    this.opTime = timing;
};

/**************************************/
B220Processor.prototype.floatingMultiply = function floatingMultiply() {
    /* Algebraically multiply the floating-point multiplicand in the IB register
    by the floating-point multiplier in the A register, producing a 18-digit
    product (16 mantissa + 2 exponent) in A and R. All values are BCD with the
    sign in the 11th digit position. The floating exponent is in the first two
    digit positions, biased by 50. Sets the Digit Check alarm as necessary */
    var ad;                             // current product (A) digit;
    var ax;                             // product/multiplier (A) exponent
    var am = this.A.value % 0x10000000000;    // product (A) mantissa
    var aSign = ((this.A.value - am)/0x10000000000)%2;
    var count = 0;                      // count of word-times consumed
    var dx;                             // multiplicand exponent
    var dm;                             // multiplicand mantissa
    var dSign;                          // multiplicand sign
    var rc;                             // dup of rd for add counting
    var rd;                             // current multipler (R) digit;
    var rm = 0;                         // current multiplier (R) mantissa
    var sign;                           // local copy of sign toggle (sign of product)
    var timing = 0.085;                 // minimum instruction timing
    var x;                              // digit counter

    this.SUT.set(0);
    this.E.set(this.CADDR);
    this.readMemory();
    if (this.MET.value) {               // invalid address
        return;                         // exit to Operation Complete
    }

    dm = this.IB.value % 0x10000000000;
    dSign = ((this.IB.value - dm)/0x10000000000)%2;

    ax = (am - am%0x100000000)/0x100000000;
    am %= 0x100000000;
    dx = (dm - dm%0x100000000)/0x100000000;
    dm %= 0x100000000;

    if (am < 0x10000000) {              // A is not normalized, so assume zero
        this.A.set(0);
        this.R.set(0);
    } else if (dm < 0x10000000) {       // D is not normalized, so assume zero
        this.A.set(0);
        this.R.set(0);
    } else {
        sign = (aSign ^ dSign);
        rm = am;                        // shift A:08 to R:98, then shift R again right 1
        am = 0;                         // result of shifting A to R
        dm *= 0x100;                    // circulate D two places left (D:22 is 0, so a simple shift left will do)

        x = this.bcdAdd(ax, dx, 3);     // do exponent arithmetic into temp x
        ax = this.bcdAdd(0x50, x, 3, 1, 1);// subtract the exponent bias from the A exponent
        timing += 0.080;
        if (x >= 0x150) {               // exponent overflow
            this.OFT.set(1);
            this.A.set(0);
            this.R.set(rm);
        } else if (x < 0x50) {          // exponent underflow
            this.A.set(0);
            this.R.set(0);
            dm %= 0x100000000;
        } else {
            // We now have the multiplicand in D (dm), the multiplier in R (rm), and an
            // initial product of zero in A (am). Go through a classic multiply cycle,
            // doing repeated addition based on each multipler digit, and between digits
            // shifting the product (in am and rm) one place to the right. After 8 digits,
            // we're done, except for normalization.

            for (x=0; x<8; ++x) {
                rd = rm % 0x10;
                count += B220Processor.multiplyDigitCounts[rd];
                for (rc=rd; rc>0; --rc) {
                    am = this.bcdAdd(am, dm, 11, 0, 0);
                } // while rd

                ad = am % 0x10;
                am = (am-ad)/0x10;
                rm = (rm-rd)/0x10 + ad*0x1000000000;
            } // for x

            // Normalize the result as necessary.
            if (am >= 0x1000000000) {
                // Shift product two places right
                timing += 0.020;
                ad = am % 0x100;
                am = (am-ad)/0x100;
                rd = rm % 0x100;
                rm = (rm-rd)/0x100 + ad*0x100000000;
                ax = this.bcdAdd(0x02, ax, 3, 1, 1);    // decrement exponent
            } else if (ax > 0) {
                // Shift product one place right
                timing += 0.010;
                ad = am % 0x10;
                am = (am-ad)/0x10;
                rd = rm % 0x10;
                rm = (rm-rd)/0x10 + ad*0x1000000000;
                ax = this.bcdAdd(0x01, ax, 3, 1, 1);    // decrement exponent
            } else {
                // Exponent underflow: set R and the reconstructed A to zero.
                am = ax = rm = sign = 0;
            }

            // Reconstruct the final product in the registers
            this.A.set((sign*0x100 + ax)*0x100000000 + am);
            this.R.set(sign*0x10000000000 + rm);
            timing += 0.005*count;
        }

        // Set the registers and toggles for display
        this.SGT.set(sign);
        this.DST.set(dSign);
        this.AX.set(ax);
        this.DX.set(dx);
        this.D.set(dm);
    }

    this.opTime = timing;
};

/**************************************/
B220Processor.prototype.floatingDivide = function floatingDivide() {
    /* Algebraically divide the 18-digit (16 mantissa + 2 exponent) floating-
    point dividend in the A & R registers by the floating-point divisor in the
    D register, producing a 9- or 10-digit quotient in the A & R registers
    and a 6- or 7-digit remainder in the low-order digits of the R register.
    See the Floating Point Handbook for the gory details of the result format.
    All values are BCD with the sign in the 11th digit position. The floating
    exponent is in the first two digit positions, biased by 50. Sets the
    Digit Check alarm as necessary */
    var ax;                             // dividend/quotient exponent
    var am = this.A.value % 0x10000000000;    // current remainder (A) mantissa
    var aSign = ((this.A.value - am)/0x10000000000)%2;
    var count = 0;                      // count of word-times consumed
    var dx;                             // divisor exponent
    var dm;                             // divisor mantissa
    var dSign;                          // divisor sign
    var rd;                             // current quotient (R) digit;
    var rm = this.R.value%0x10000000000;// current quotient (R) mantissa (ignore sign)
    var sign;                           // local copy of sign toggle (sign of quotient)
    var timing = 0.085;                 // minimum instruction timing
    var tSign = 1;                      // sign for timing count accumulation
    var x;                              // digit counter

    this.E.set(this.CADDR);
    this.readMemory();
    if (this.MET.value) {               // invalid address
        return;                         // exit to Operation Complete
    }

    dm = this.IB.value % 0x10000000000;
    dSign = ((this.IB.value - dm)/0x10000000000)%2;
    sign = aSign ^ dSign;
    this.SUT.set(1);

    ax = (am - am%0x100000000)/0x100000000;
    am %= 0x100000000;
    dx = (dm - dm%0x100000000)/0x100000000;
    dm %= 0x100000000;

    if (am < 0x10000000 && dm >= 0x10000000) {
        this.A.set(0);                  // A is not normalized but D is, =quotient=0
        this.R.set(0);
    } else if (dm < 0x10000000) {
        this.OFT.set(1);                // D is not normalized, overflow (div 0)
        this.A.set(am);
    } else {
        // Add the exponent bias to the dividend exponent and check for underflow
        ax = this.bcdAdd(ax, 0x50, 3);
        timing += 0.085;
        if (ax < dx) {
            // Exponents differ by more than 50 -- underflow
            sign = 0;
            this.A.set(0);
            this.R.set(0);
        } else {
            // If dividend >= divisor, scale the exponent by 1
            if (am >= dm) {
                ax = this.bcdAdd(ax, 1, 3);
            }
            // Subtract the exponents and check for overflow
            ax = this.bcdAdd(dx, ax, 3, 1, 1);
            if (ax > 0x99) {
                this.OFT.set(1);
                sign = 0;
                this.A.set(am);
                this.R.set(rm);
            } else {
                // We now have the divisor in D (dm) and the dividend in A (am) & R (rm).
                // The value in am will become the remainder; the value in rm will become
                // the quotient. Go through a classic long-division cycle, repeatedly
                // subtracting the divisor from the dividend, counting subtractions until
                // underflow occurs, and shifting the divisor left one digit.
                // The 220 probably did not work quite the way that it has been mechanized
                // below, which is close to the way the 205 emulator works.

                for (x=0; x<10; ++x) {
                    // Repeatedly subtract D from A until we would get underflow.
                    rd = 0;
                    while (am >= dm) {
                        am = this.bcdAdd(dm, am, 11, 1, 1);
                        ++rd;
                        count += tSign;
                    }

                    // Shift A & R to the left one digit, accumulating the quotient digit in R
                    rm = rm*0x10 + rd;
                    rd = (rm - rm%0x10000000000)/0x10000000000;
                    rm %= 0x10000000000;
                    if (x < 9) {
                        am = am*0x10 + rd;      // shift into remainder except on last digit
                    }

                    tSign = -tSign;
                } // for x

                // Rotate the quotient from R into A for 8 digits or until it's normalized
                for (x=0; x<8 || am < 0x10000000; ++x) {
                    rd = (am - am%0x1000000000)/0x1000000000;
                    rm = rm*0x10 + rd;
                    rd = (rm - rm%0x10000000000)/0x10000000000;
                    rm %= 0x10000000000;
                    am = (am%0x10000000)*0x10 + rd;
                }

                // Reconstruct the final product in the registers
                this.A.set((sign*0x100 + ax)*0x100000000 + am);
                this.R.set(sign*0x10000000000 + rm);
                timing += 4.075 + 0.060*count;
            }
        }

        // Set the registers and toggles for display
        this.AX.set(ax);
        this.DX.set(dx);
        this.D.set(dm);
    }

    this.SGT.set(sign);
    this.DST.set(dSign);
    this.opTime = timing;
};


/***********************************************************************
*   Partial-Word Operations                                            *
***********************************************************************/

/**************************************/
B220Processor.prototype.compareField = function compareField() {
    /* Implements CFA/CFR (18). Compares the value in either the A or R register
    to a word in memory, either whole word or a designated partial field, by
    subtracting the respective memory digits from the register digits. Sets
    the comparison indicators (UET, HIT) to indicate whether the register field
    is LOW (UET=1, HIT=0), EQUAL (UET=0, HIT=1), or HIGH (UET=1, HIT=1) with
    respect to the memory field. Note that the sign digit, if included in the
    comparison is handled in a very strange fashion -- see the discussion in the
    220 Operational Characteristics manual for the truly gruesome details */
    var adder = 0;                      // current adder digit
    var carry = 1;                      // carry flag defaults to 1, since we're subtracting
    var compl = 1;                      // do complement addition by default, since we're subtracting
    var dd;                             // current memory (D-register) digit
    var dSign = 0;                      // memory (D-register) sign
    var dw;                             // memory (D-register) word
    var high = 1;                       // initialize compare toggles to EQUAL
    var L;                              // partial-word length
    var rSign;                          // register sign digit
    var rd;                             // current register digit
    var rw;                             // register word value
    var s;                              // partial-word "s" digit
    var sign = 1;                       // default sign is negative, since we're subtracting
    var unequal = 0;                    // initialize compare toggles to EQUAL

    this.opTime = 0.150;
    this.E.set(this.CADDR);
    this.UET.set(0);
    this.HIT.set(0);
    this.readMemory();
    if (!this.MET.value) {
        this.SUT.set(1);
        dw = this.IB.value;
        this.D.set(dw);

        if (this.CCONTROL%0x10 == 1) {
            rw = this.R.value;          // CFR: Compare Field R
        } else {
            rw = this.A.value;          // CFA: Compare Field A
        }

        // Determine field lengths for partial- or whole-word comparison.
        if (!(this.CCONTROL & 0x10)) {  // whole word
            s = 10;
            L = 11;
        } else {                        // partial word
            s = this.CCONTROL >>> 12;
            if (s == 0) {
                s = 10;
            }
            L = (this.CCONTROL >>> 8)%0x10;
            if (L == 0) {
                L = 10;
            }
        }

        // If the sign digit is included in the comparison, set up for algebraic
        // comparison and the strange sign ordering.
        if (L > s) {                    // sign digit is included
            rSign = (rw - rw%0x10000000000)/0x10000000000;
            dSign = (dw - dw%0x10000000000)/0x10000000000;
            sign = 1-dSign%2;
            compl = (rSign^sign)%2;
            carry = compl;
            if (rSign < 8) {
                rSign ^= 3;             // complement two low bits of sign
            }
            rw = rw%0x10000000000 + rSign*0x10000000000;

            if (dSign < 8) {
                dSign ^= 3;             // complement two low bits of sign
            }
            dw = dw%0x10000000000 + dSign*0x10000000000;
        }

        // Now go through a modified add cycle, subtracting the digit pairs using
        // 9s-complement addition, and updating the comparison toggles for each digit.
        this.DC.set(0x09);              // set up to rotate 11 digits
        while (this.DC.value < 0x20) {
            rd = rw%0x10;
            dd = dw%0x10;
            if (s < 10) {               // positition to the "s" digit
                ++s;
            } else if (L > 0) {
                --L;
                this.X.set(rd);         // for display only
                this.Y.set(dd);
                adder = (compl ? 9-rd : rd) + dd + carry;
                if (adder < 10) {       // decimal correct the adder
                    carry = 0;
                } else {
                    carry = 1;
                    adder -= 10;
                }

                this.Z.set(adder);      // for display only
                if (adder) {            // if the adder is not zero,
                    unequal = 1;        // result will be unequal, determined by sign
                }
            } else {
                // Ignore any digits after L is exhausted
            }

            // Shift both words right (no need to rotate them)
            rw = (rw-rd)/0x10;
            dw = (dw-dd)/0x10;
            this.DC.inc();
        } // while DC < 20

        // If we are complementing and there is no final carry, we would normally
        // decomplement the result and reverse the sign, but decomp is not needed.
        // If we are not complementing and there is a final carry, we have overflow.
        if (compl ^ carry) {
            if (carry) {
                unequal = 1;            // overflow, so force unequality
            } else {
                sign = 1-sign;          // reverse sign (pseudo decomplement)
            }
        }

        // Set the console lamps and toggles to the result.
        if (unequal) {                  // result is unequal, sign determines low/high
            high = 1-sign;              // negative=low, positive=high
            this.compareEqualLamp.set(0);
            this.compareLowLamp.set(1-high);
            this.compareHighLamp.set(high);
        } else {
            this.compareEqualLamp.set(1);
            this.compareLowLamp.set(0);
            this.compareHighLamp.set(0);
        }

        this.DST.set(dSign);
        this.SGT.set(sign);
        this.HIT.set(high);
        this.UET.set(unequal);

        this.CCONTROL = ((s%10)*0x10 + L)*0x100 + this.CCONTROL%0x100;
        this.C.set((this.CCONTROL*0x100 + this.COP)*0x10000 + this.CADDR);
        if (L > 0) {
            this.setProgramCheck(1);
        }
    }
};

/**************************************/
B220Processor.prototype.increaseFieldLocation = function increaseFieldLocation() {
    /* Implements IFL (26). Increments a designated partial field in a memory
    word by the two-digit value in (42) of the C register */
    var adder = 0;                      // current adder digit
    var carry = 0;                      // carry flag defaults to 0, since we're adding
    var dd;                             // current memory (D-register) digit
    var dw;                             // memory (D-register) word
    var L;                              // partial-word length
    var rd;                             // current increase digit
    var rw;                             // increase value
    var s;                              // partial-word "s" digit

    this.opTime = 0.160;
    this.SUT.set(0);
    this.DST.set(0);
    this.SGT.set(0);
    this.E.set(this.CADDR);
    this.readMemory();
    if (!this.MET.value) {
        dw = this.IB.value;
        this.D.set(dw);
        rw = this.CCONTROL%0x100;       // increase value

        s = this.CCONTROL >>> 12;
        if (s == 0) {
            s = 10;
        }
        L = (this.CCONTROL >>> 8)%0x10;
        if (L == 0) {
            L = 10;
        }

        // Now go through a modified add cycle for each digit.
        this.DC.set(0x09);              // set up to rotate 11 digits
        while (this.DC.value < 0x20) {
            dd = dw%0x10;               // get digit from memory value
            if (s < 10) {               // positition to the "s" digit
                ++s;
                adder = dd;             // just copy the digit
            } else if (L > 0) {         // operate on the partial-word field
                --L;
                rd = rw%0x10;           // get digit from increase value
                this.X.set(rd);         // for display only
                this.Y.set(dd);
                adder = rd + dd + carry;
                if (adder < 10) {       // decimal correct the adder
                    carry = 0;
                } else {
                    carry = 1;
                    adder -= 10;
                }

                this.Z.set(adder);      // for display only
                rw = (rw-rd)/0x10;      // shift the increase value right
            } else {
                adder = dd;             // copy any remaining digits after L is exhausted
            }

            dw = (dw-dd)/0x10 + adder*0x10000000000; // rotate result into memory value
            this.DC.inc();
        } // while DC < 20

        this.D.set(dw);
        this.IB.set(dw);
        this.C10.set(carry);            // set carry toggle
        this.OFT.set(carry);            // set overflow if there's a carry

        this.CCONTROL = ((s%10)*0x10 + L)*0x100 + this.CCONTROL%0x100;
        this.C.set((this.CCONTROL*0x100 + this.COP)*0x10000 + this.CADDR);
        if (L > 0) {                    // check whether L was decremented to zero
            this.setProgramCheck(1);
        } else {
            this.writeMemory();
        }
    }
};

/**************************************/
B220Processor.prototype.decreaseFieldLocation = function decreaseFieldLocation(loadB) {
    /* Implements DFL/DLB (27, 28). Decrements a designated partial field in a memory
    word by the two-digit value in (42) of the C register */
    var adder = 0;                      // current adder digit
    var carry = 1;                      // carry flag defaults to 1, since we're subtracting
    var dd;                             // current memory (D-register) digit
    var dw;                             // memory (D-register) word
    var L;                              // partial-word length
    var rd;                             // current decrease digit
    var rw;                             // decrease value
    var s;                              // partial-word "s" digit

    this.opTime = 0.160;
    this.SUT.set(1);
    this.DST.set(1);
    this.SGT.set(0);
    this.RPT.set(0);
    if (loadB) {
        this.B.set(0);
    }

    this.E.set(this.CADDR);
    this.readMemory();
    if (!this.MET.value) {
        dw = this.IB.value;
        this.D.set(dw);
        rw = this.CCONTROL%0x100;       // decrease value

        s = this.CCONTROL >>> 12;
        if (s == 0) {
            s = 10;
        }
        L = (this.CCONTROL >>> 8)%0x10;
        if (L == 0) {
            L = 10;
        }

        // Now go through a modified add cycle for each digit.
        this.DC.set(0x09);              // set up to rotate 11 digits
        while (this.DC.value < 0x20) {
            dd = dw%0x10;               // get digit from memory value
            if (s < 10) {               // positition to the "s" digit
                ++s;
                adder = dd;             // just copy the digit
            } else if (L > 0) {         // operate on the partial-word field
                --L;
                rd = rw%0x10;           // get digit from decrease value
                this.X.set(rd);         // for display only
                this.Y.set(dd);
                adder = 9 - rd + dd + carry;
                if (adder < 10) {       // decimal correct the adder
                    carry = 0;
                } else {
                    carry = 1;
                    adder -= 10;
                }

                this.Z.set(adder);      // for display only
                rw = (rw-rd)/0x10;      // shift the decrease value right
                if (loadB) {            // shift adder digit into B if op=DLB
                    this.B.value = (this.B.value - this.B.value%0x10)/0x10 + adder*0x1000;
                }
            } else {
                adder = dd;             // copy any remaining digits after L is exhausted
            }

            dw = (dw-dd)/0x10 + adder*0x10000000000; // rotate result into memory value
            this.DC.inc();
        } // while DC < 20

        this.D.set(dw);
        this.IB.set(dw);
        this.C10.set(carry);            // set carry toggle
        if (carry) {
            this.RPT.set(1);            // set repeat toggle if no underflow
        }
        if (loadB) {                    // set B register if op=DLB
            this.B.set(this.B.value);
        }

        this.CCONTROL = ((s%10)*0x10 + L)*0x100 + this.CCONTROL%0x100;
        this.C.set((this.CCONTROL*0x100 + this.COP)*0x10000 + this.CADDR);
        if (L > 0) {                    // check whether L was decremented to zero
            this.setProgramCheck(1);
        } else {
            this.writeMemory();
        }
    }
};

/**************************************/
B220Processor.prototype.branchField = function branchField(regValue) {
    /* Implements BFA/BFR (36, 37). Compares digits of a designated partial
    field in the A or R register word to a rotating two-digit value in (42) of
    the C register */
    var adder = 0;                      // current adder digit
    var carry = 1;                      // carry flag defaults to 1, since we're subtracting
    var dd;                             // current pattern digit
    var dw;                             // rotating 2-digit pattern value
    var equal = 1;                      // start out assuming equality
    var L;                              // partial-word length
    var rd;                             // current register digit
    var rw = regValue;                  // register value
    var s;                              // partial-word "s" digit

    this.opTime = 0.075;
    this.SUT.set(1);
    dw = this.CCONTROL%0x100;           // 2-digit pattern to compare

    s = this.CCONTROL >>> 12;
    if (s == 0) {
        s = 10;
    }
    L = (this.CCONTROL >>> 8)%0x10;
    if (L == 0) {
        L = 10;
    }

    // Now position the word and compare digits to the rotating pattern.
    this.DC.set(0x09);                  // set up to rotate 11 digits
    while (this.DC.value < 0x20) {
        rd = rw%0x10;                   // get digit from register value
        if (s < 10) {                   // positition to the "s" digit
            ++s;                        // just ignore any initial digits
        } else if (L > 0) {             // operate on the partial-word field
            --L;
            dd = dw%0x10;               // get digit from increase value
            this.X.set(rd);             // for display only
            this.Y.set(dd);
            adder = 9 - rd + dd + carry;
            if (adder < 10) {           // decimal correct the adder
                carry = 0;
            } else {
                carry = 1;
                adder -= 10;
            }

            this.Z.set(adder);          // for display only
            dw = (dw-dd)/0x10 + dd*0x10;// rotate the 2-digit pattern
            if (adder) {
                equal = 0;              // if the adder is not zero, fields are unequal
            }
        } else {
            // just ignore any remaining digits after L is exhausted
        }

        rw = (rw-rd)/0x10;              // shift register word right (no need to rotate it)
        this.DC.inc();
    } // while DC < 20

    this.C10.set(carry);                // set carry toggle, for display only
    if (equal) {                        // if equality exists, branch
        this.opTime += 0.020;
        this.P.set(this.CADDR);
    }

    this.CCONTROL = ((s%10)*0x10 + L)*0x100 + this.CCONTROL%0x100;
    this.C.set((this.CCONTROL*0x100 + this.COP)*0x10000 + this.CADDR);
    if (L > 0) {                        // check whether L was decremented to zero
        this.setProgramCheck(1);
    }
};

/**************************************/
B220Processor.prototype.storeRegister = function storeRegister() {
    /* Implements STA/STR/STB (40). Stores a whole word or a designated partial
    field in a memory word based on the sL (22) digits of the C register */
    var adder;                          // current adder digit
    var dd;                             // current memory (D-register) digit
    var dw;                             // memory (D-register) word
    var L;                              // partial-word length
    var rd;                             // current increase digit
    var rw;                             // increase value
    var s;                              // partial-word "s" digit
    var xd;                             // current D-register digit
    var xw = 0;                         // word used to construct the D-register value

    this.opTime = 0.100;
    this.E.set(this.CADDR);
    this.readMemory();
    if (!this.MET.value) {
        switch (this.CCONTROL%0x10) {
        case 1:         // STR: Store R
            rw = this.R.value;
            break;
        case 2:         // STB: Store B
            rw = this.B.value;
            break;
        default:        // STA: Store A
            rw = this.A.value;
            break;
        } // switch

        if ((this.CCONTROL & 0x10) == 0) {  // whole-word store
            this.D.set(rw);
            this.IB.set(rw);
            s = L = 0;
        } else {                            // partial-word store
            this.D.set(0);
            dw = this.IB.value;

            s = this.CCONTROL >>> 12;
            if (s == 0) {
                s = 10;
            }
            L = (this.CCONTROL >>> 8)%0x10;
            if (L == 0) {
                L = 10;
            }

            // Now position the field and copy the digits
            this.DC.set(0x09);          // set up to rotate 11 digits
            while (this.DC.value < 0x20) {
                rd = rw%0x10;           // get digit from register value
                dd = dw%0x10;           // get digit from memory value
                if (s < 10) {           // positition to the "s" digit
                    ++s;
                    adder = dd;         // just copy the memory digit
                    xd = 0;
                } else if (L > 0) {     // operate on the partial-word field
                    --L;
                    adder = rd;         // copy digit from register into memory value
                    xd = rd;
                } else {
                    adder = dd;         // just copy any remaining memory digits after L is exhausted
                    xd = 0;
                }

                dw = (dw-dd)/0x10 + adder*0x10000000000; // rotate result digit into memory value
                rw = (rw-rd)/0x10;      // shift register value right (no need to rotate it)
                xw = xw/0x10 + xd*0x10000000000;        // copy zero or register digit into D-register
                this.DC.inc();
            } // while DC < 20

            this.D.set(xw);
            this.IB.set(dw);
        }

        this.CCONTROL = ((s%10)*0x10 + L)*0x100 + this.CCONTROL%0x100;
        this.C.set((this.CCONTROL*0x100 + this.COP)*0x10000 + this.CADDR);
        if (L > 0) {                    // check whether L was decremented to zero
            this.setProgramCheck(1);
        } else {
            this.writeMemory();
        }
    }
};


/***********************************************************************
*   Console I/O Module                                                 *
***********************************************************************/

/**************************************/
B220Processor.prototype.keyboardAction = function keyboardAction(d) {
    /* Receives a single digit from the Console keyboard. Non-negative values of
    d indicate decimal digit keys and are shifted into the low-order digit of D.
    Negative values of d indicate function keys:
        -1 = ADD key pressed
        -2 = C key pressed
        -3 = E key pressed
        -4 = EXAM key pressed
        -5 = ENT key pressed
        -6 = STEP key pressed
    */
    var word = this.D.value;

    if (!this.RUT.value) {              // make sure we're not running
        switch (d) {
        case 0: case 1: case 2: case 3: case 4:
        case 5: case 6: case 7: case 8: case 9:
            this.D.set((this.D.value%0x10000000000)*0x10 + d);
            break;
        case -1:                        // ADD key pressed
            this.keyboardAdd();
            break;
        case -2:                        // C key pressed, do D -> C
            this.fetchWordToC(word);
            break;
        case -3:                        // E key pressed, do D -> E
            this.E.set(word%0x10000);
            this.D.set(0);
            break;
        case -4:                        // EXAM key pressed, memory -> D
            this.readMemory();
            if (!this.MET.value) {              // invalid address
                this.E.inc();
                this.D.set(this.IB.value);
            }
            break;
        case -5:                        // ENT key pressed, D -> memory
            this.IB.set(word);
            this.writeMemory();
            if (!this.MET.value) {
                this.E.inc();
            }
            break;
        case -6:                        // STEP key pressed
            this.step();
            break;
        } // switch d
    }
};

/**************************************/
B220Processor.prototype.keyboardAdd = function keyboardAdd() {
    /* Algebraically add the addend (D) to the augend (A), returning the result
    in A. Similar to integerAdd(), except (a) the processor must not be running,
    (b) there is no reference to memory, (c) the addend comes from D instead of
    IB, (d) subtract is not possible, although the numbers may be signed, and
    (e) the processor is returned to running status after the add completes.
    No timing is accumulated because the processor has been stopped */
    var am = this.A.value % 0x10000000000;      // augend mantissa
    var aSign = ((this.A.value - am)/0x10000000000)%2;
    var compl;                                  // complement addition required
    var dm = this.D.value % 0x10000000000;      // addend mantissa
    var dSign = ((this.D.value - dm)/0x10000000000)%2;
    var sign = dSign;                           // local copy of sign toggle

    if (!this.RUT.value) {                      // we must be stopped
        this.SUT.set(0);
        compl = (aSign^sign);
        am = this.bcdAdd(am, dm, 11, compl, compl);

        // Now examine the resulting sign (still in the adder) to see if we
        // have overflow or need to recomplement the result.
        switch (this.Z.value) {
        case 0:
            am += sign*0x10000000000;
            break;
        case 1:
            am += (sign-1)*0x10000000000;
            this.OFT.set(1);
            break;
        default: // sign is 9
            // reverse the sign toggle and recomplement the result (virtually adding to the zeroed dm)
            sign = 1-sign;
            am = this.bcdAdd(am, 0, 11, 1, 1);
            // after recomplementing, set the correct sign (adder still contains sign of result)
            am += (sign - this.Z.value)*0x10000000000;
            break;
        } // switch this.Z.value

        if (am%0x10000000000 == 0) {
            am = aSign*0x10000000000;
        }

        // Set toggles for display purposes and return the result
        this.DST.set(dSign);
        this.SGT.set(sign);
        this.A.set(am);
        this.start();
    }
};

/**************************************/
B220Processor.prototype.consoleOutputSign = function consoleOutputSign(printSign) {
    /* Outputs the sign character for a SPO (09) command and sets up to output the
    first number digit */
    var d;
    var w;

    this.clockIn();
    if (this.AST.value) {               // if false, we've probably been cleared
        d = this.bcdAdd(this.CCONTROL, 0x990, 3); // decrement word count
        this.CCONTROL += d - this.CCONTROL%0x1000;
        this.C.set((this.CCONTROL*0x100 + this.COP)*0x10000 + this.CADDR);
        this.E.set(this.CADDR);
        this.readMemory();
        if (this.MET.value) {           // invalid address
            this.ioComplete(true);
        } else {
            this.D.set(this.IB.value);
            this.execClock += 0.070;    // estimate for memory access and rotation
            w = this.D.value%0x10000000000;
            d = (this.D.value - w)/0x10000000000; // get the sign digit
            this.D.set(w*0x10 + d);     // rotate D+sign left one
            this.DC.set(0x10);          // set up for 10 more digits
            this.DPT.set(this.CCONTROL%0x10 == 1 && this.COP == 0x09);
            this.LT1.set(this.LEADINGZEROESSW); // use LT1 for leading-zero suppression (probably not accurate)
            this.EWT.set(0);
            this.PZT.set(d == 2 && !this.HOLDPZTZEROSW);
            this.PA.set(0x80 + d);      // translate numerically
            printSign(this.PA.value, this.boundConsoleOutputChar);
        }
    }
};

/**************************************/
B220Processor.prototype.consoleOutputChar = function consoleOutputChar(printChar) {
    /* Outputs the next character code for a SPO (09) command and sets up to output the
    next number digit. If the Shift Counter is already at 20, terminates the
    output operation and sends a Finish signal */
    var d;
    var w;

    this.clockIn();
    if (this.AST.value) {               // if false, we've probably been cleared
        if (this.EWT.value) {
            if (this.CCONTROL%0x1000 < 0x10) {
                printChar(0x35, this.boundConsoleOutputFinished);
            } else {
                this.C.inc();
                this.CADDR = this.C.value%0x10000;
                printChar(0x35, this.boundConsoleOutputSign);
            }
        } else if (this.PZT.value) {    // Output alphabetically
            w = this.D.value % 0x1000000000;
            d = (this.D.value - w)/0x1000000000; // get next 2 digits
            this.D.set(w*0x100 + d);    // rotate D+sign left by two
            this.execClock += 0.060;    // estimate for rotation
            this.DC.inc();              // increment DC for two digits
            this.DC.inc();
            this.PA.set(d);
            if (this.DC.value >= 0x20) {
                this.EWT.set(1);
            }
            printChar(d, this.boundConsoleOutputChar);
        } else {                        // Output numerically
            if (this.DPT.value && !this.LEADINGZEROESSW) {
                // decimal point may be needed
                d = this.CCONTROL >>> 12;
                if (this.DC.value + d > 0x19) {
                    this.DPT.set(0);
                    this.LT1.set(0);    // stop any zero-suppression
                    this.PA.set(0x03);  // decimal point code
                    printChar(0x03, this.boundConsoleOutputChar);
                    return;             // early exit
                }
            }

            do {                        // suppress leading zeroes if necessary
                w = this.D.value % 0x10000000000;
                d = (this.D.value - w)/0x10000000000; // get a digit
                this.D.value = w*0x10 + d;  // rotate D+sign left by one
                this.execClock += 0.065;    // estimate for rotation
                this.DC.inc();
            } while (d == 0 && this.LT1.value && this.DC.value < 0x20);

            this.LT1.set(0);
            this.D.set(this.D.value);
            d += 0x80;                  // translate numerically
            this.PA.set(d);
            if (this.DC.value >= 0x20) {
                this.EWT.set(1);
            }
            printChar(d, this.boundConsoleOutputChar);
        }
    }
};

/**************************************/
B220Processor.prototype.consoleOutputFinished = function consoleOutputFinished() {
    /* Handles the final cycle of console output */

    this.clockIn();
    if (this.AST.value) {               // if false, we've probably been cleared
        this.EWT.set(0);
        this.ioComplete(true);
    }
};

/**************************************/
B220Processor.prototype.consoleInputFinishWord = function consoleInputFinishWord(result) {
    /* Finishes the receipt of a word from the Console paper tape reader and
    either stores it in memory or shunts it to the C register for execution.
    Updates the C register as necessary and decides whether to initiate receipt
    of another word */
    var d;
    var w;

    if (this.sDigit) {                  // decrement word count
        d = this.bcdAdd(this.CCONTROL, 0x990, 3);
        this.CCONTROL += d - this.CCONTROL%0x1000;
        this.C.set((this.CCONTROL*0x100 + this.COP)*0x10000 + this.CADDR);
    }

    if (this.COP == 0x05) {             // read inverse: permute the sign digit
        d = this.D.value%0x10;
        w = (this.D.value - d)/0x10;
        this.D.set(w + d*0x10000000000);
        if (d == 2) {                   // alphanumeric translation is invalid for inverse mode
            this.setPaperTapeCheck(1);
            this.ioComplete(true);
            return;                     // >>> ALARM ERROR EXIT <<<
        }
    } else {                            // sign digit in normal position
        w = this.D.value%0x10000000000;
        d = (this.D.value - w)/0x10000000000;
    }

    if (this.rDigit & d & 0x08) {       // B-modify word before storing
        this.D.set(w + (d&0x07)*0x10000000000);
        this.IB.set(this.D.value - w%0x10000 + this.bcdAdd(w, this.B.value, 4));
        this.C10.set(0);
    } else {                            // store word as-is
        this.IB.set(this.D.value);
    }

    if (this.rDigit == 1 && (d & 0x0E) == 0x06) { // control word to C register
        this.ioComplete(false);         // terminate I/O but do not restart Processor yet
        this.fetch(true);               // set up to execute control word
        // Schedule the Processor to give the reader a chance to finish its operation.
        setCallback(this.mnemonic, this, 0, this.schedule);
    } else {                            // just store the word
        this.writeMemory();
        if (this.MET.value) {           // memory address error
            this.ioComplete(true);
        } else if (this.sDigit && this.CCONTROL%0x1000 < 0x10) { // word count exhausted
            this.ioComplete(true);
        } else {                        // initiate input of another word
            this.D.set(0);
            if (this.COP == 0x05) {
                d = this.console.inputUnitSelect(this.selectedUnit, this.boundConsoleInputInitiateInverse);
            } else {
                d = this.console.inputUnitSelect(this.selectedUnit, this.boundConsoleInputInitiateNormal);
            }
            if (d < 0) {                // no unit available -- set alarm and quit
                this.setPaperTapeCheck(1);
                this.ioComplete(true);
            }
        }
    }
};

/**************************************/
B220Processor.prototype.consoleInputInitiateNormal = function consoleInputInitiateNormal(result) {
    /* Initiates the receipt into a word of characters from the Console tape
    reader in normal (sign-first) mode. Increments the C register operand address,
    rotates the sign digit into the D register, and determines whether the word
    should be translated numerically or alphanumerically */
    var code = result.code;

    this.clockIn();
    if (this.AST.value) {               // if false, we've probably been cleared
        this.E.set(this.CADDR);
        this.C.inc();
        this.CADDR = this.C.value%0x10000;

        switch (code) {
        case 0x17:                      // invalid character/parity error
            this.setPaperTapeCheck(1);
            this.ioComplete(true);
            break;
        case 0x35:                      // end-of-word
            this.consoleInputFinishWord(result);
            break;
        case 0x82:                      // sign=2, set alpha translation
            this.PZT.set(!this.HOLDPZTZEROSW);
            this.D.set(2);
            result.readChar(this.boundConsoleInputReceiveChar);
            break;
        default:                        // anything else, set numeric translation
            this.PZT.set(0);
            if ((code & 0xF0) == 0x80) {// it's a numeric sign -- okay
                this.D.set(code%0x10);
                result.readChar(this.boundConsoleInputReceiveChar);
            } else if (code == 0) {     // we'll take a space as a zero
                this.D.set(0);
                result.readChar(this.boundConsoleInputReceiveChar);
            } else {                    // sign is non-numeric -- invalid
                this.D.set(0);
                this.setPaperTapeCheck(1);
                this.ioComplete(true);
            }
            break;
        } // switch code
    }
};

/**************************************/
B220Processor.prototype.consoleInputInitiateInverse = function consoleInputInitiateInverse(result) {
    /* Initiates the receipt into a word of characters from the Console tape
    reader in inverse (sign-last) mode. Increments the C register operand address,
    rotates the sign digit into the D register, and sets PZT for numeric translation */
    var code = result.code;

    this.clockIn();
    if (this.AST.value) {               // if false, we've probably been cleared
        this.E.set(this.CADDR);
        this.C.inc();
        this.CADDR = this.C.value%0x10000;

        switch (code) {
        case 0x17:                      // invalid character/parity error
            this.setPaperTapeCheck(1);
            this.ioComplete(true);
            break;
        case 0x35:                      // end-of-word
            this.consoleInputFinishWord(result);
            break;
        default:                        // anything else, set numeric translation
            this.PZT.set(0);
            if ((code & 0xF0) == 0x80) {// it's a numeric code -- okay
                this.D.set(code%0x10);
                result.readChar(this.boundConsoleInputReceiveChar);
            } else if (code == 0) {     // we'll take a space as a zero
                this.D.set(0);
                result.readChar(this.boundConsoleInputReceiveChar);
            } else {                    // digit is non-numeric -- invalid
                this.D.set(0);
                this.setPaperTapeCheck(1);
                this.ioComplete(true);
            }
            break;
        } // switch code
    }
};

/**************************************/
B220Processor.prototype.consoleInputReceiveChar = function consoleInputReceiveChar(result) {
    /* Handles an input character coming from the Console paper-tape reader.
    result.code is the B220 character code read from the device. result.readChar
    is the callback function to request the next character. Data digits are
    rotated into the D register; end-of-word (0x35) codes are handled according
    to the sign digit in the D register */
    var code = result.code;             // character received
    var sign;                           // register sign digit
    var word;                           // register word less sign

    this.clockIn();
    if (this.AST.value) {               // if false, we've probably been cleared
        switch (code) {
        case 0x17:                      // invalid character/parity error
            this.setPaperTapeCheck(1);
            this.ioComplete(true);
            break;
        case 0x35:                      // end-of-word
            this.consoleInputFinishWord(result);
            break;
        default:                        // anything else, accumulate digits in word
            if (this.PZT.value) {       // alphanumeric translation
                this.D.set((this.D.value % 0x1000000000)*0x100 + code);
                result.readChar(this.boundConsoleInputReceiveChar);
            } else {                    // numeric translation
                if ((code & 0xF0) == 0x80) {// it's a numeric code -- okay
                    this.D.set((this.D.value % 0x10000000000)*0x10 + code%0x10);
                    result.readChar(this.boundConsoleInputReceiveChar);
                } else if (code == 0) {     // we'll take a space as a zero
                    this.D.set((this.D.value % 0x10000000000)*0x10);
                    result.readChar(this.boundConsoleInputReceiveChar);
                } else {                    // code is non-numeric -- invalid
                    this.setPaperTapeCheck(1);
                    this.ioComplete(true);
                }
            }
            break;
        } // switch code
    }
};

/***********************************************************************
*   Cardatron I/O Module                                               *
***********************************************************************/

/**************************************/
B220Processor.prototype.cardatronOutputWord = function cardatronOutputWord() {
    /* Initiates a read of the next word from memory for output to the
    Cardatron Control Unit. Returns a negative number to stop transfer */
    var word;

    this.clockIn();
    if (!this.AST.value) {              // we've probably been cleared
        word = -1;
    } else if (this.MET.value) {        // previous memory access error
        word = 0;
    } else {
        word = this.readMemory();       // address in E was previously set
        if (this.MET.value) {
            word = 0;
        } else {
            this.E.dec();               // step down to next memory address
        }

        this.execClock += 0.117;        // time for full-word transfer
    }

    return word;
};

/**************************************/
B220Processor.prototype.cardatronOutputFinished = function cardatronOutputFinished() {
    /* Handles the final cycle of an I/O operation and restores this.execTime */

    if (this.AST.value) {               // if false, we've probably been cleared
        this.ioComplete(true);
    }
};

/**************************************/
B220Processor.prototype.cardatronReceiveWord = function cardatronReceiveWord(word) {
    /* Handles a word coming from the Cardatron input unit. Negative values for
    the word indicates this is the last word and the I/O is finished. Otherwise,
    the word is stored into the D register and is handled according to the sign
    digit in the D register. The last word received (typically a "pusher" word
    of zeroes) is abandoned and not acted upon. Returns -1 if further data
    transfer is to be terminated, 0 otherwise */
    var returnCode = 0;                 // default is to continue receiving
    var sign;                           // D-register sign digit

    this.clockIn();
    if (!this.AST.value) {              // we've probably been cleared
        returnCode = -1;
    } else if (word < 0) {
        // Last word received -- finished with the I/O
        this.D.set(word-0x900000000000);// remove the finished signal; for display only, not stored
        this.ioComplete(true);
        returnCode = -1;
    } else if (this.MET.value) {
        // Memory error has occurred: just ignore further data from Cardatron
    } else {
        // Full word accumulated -- process it and initialize for the next word
        this.D.set(word);
        word %= 0x10000000000;          // strip the sign digit
        sign = (this.D.value - word)/0x10000000000; // get D-sign

        switch (sign) {
        case 0:                         // sign is 0-5: store word normally
        case 1:
        case 2:
        case 3:
        case 4:
        case 5:
            this.IB.set(this.D.value);
            this.writeMemory();
            if (!this.MET.value) {
                this.E.dec();                   // decrement memory address for next word
            }
            break;

        case 6:                         // sign is 6, 7: execute control word
        case 7:
            if (this.vDigit & 0x01) {           // input control words are inhibited
                this.IB.set(this.D.value);
                this.writeMemory();             // just store the word with its sign
                if (!this.MET.value) {
                    this.E.dec();               // decrement memory address for next word
                }
            } else {                            // input control words are executed
                this.IB.set(this.D.value);      // move word to IB for use by fetch()
                this.ioComplete(false);         // terminate I/O but do not restart Processor yet
                this.fetch(true);               // set up to execute control word
                returnCode = -1;                // stop further input from Cardatron
                // Schedule the Processor to give Cardatron a chance to finish its operation.
                setCallback(this.mnemonic, this, 0, this.schedule);
            }
            break;

        default:                        // sign is 8, 9: store word with optional B mod
            if (!(this.rDigit & 0x08)) {        // no B-register modification
                this.IB.set(this.D.value);
            } else {                            // add B to low-order four digits of word
                word = word - word%0x100000 + this.bcdAdd(word, this.B.value, 4);
                this.C10.set(0);                // reset carry toggle
                this.IB.set((sign%2)*0x10000000000 + word);
            }
            this.writeMemory();
            if (!this.MET.value) {
                this.E.dec();                   // decrement memory address for next word
            }
            break;
        } // switch sign

        this.execClock += 0.117;        // time for full-word transfer
    }

    return returnCode;
};

/***********************************************************************
*   Magnetic Tape I/O Module                                           *
***********************************************************************/

/**************************************/
B220Processor.prototype.magTapeComplete = function magTapeComplete(alarm, control, word) {
    /* Call-back routine to signal completion of a magnetic tape operation. If
    "alarm" is true, the Magnetic Tape Alarm will be set. If "control" is true,
    the contents of "word" are processed as a tape control word and an appropriate
    branch is set up. Unconditionally terminates the tape I/O instruction */
    var aaaa;
    var bbbb;

    if (alarm) {
        this.setMagneticTapeCheck(true);
    } else if (control) {
        this.D.set(word);
        bbbb = word%0x10000;
        aaaa = ((word - bbbb)/0x10000)%0x10000;
        if ((word - word%0x10000000000)%2) {            // if sign bit is 1,
            bbbb = this.bcdAdd(bbbb, this.B.value, 4);  // B-adjust the low-order 4 digits
        }

        this.E.set(aaaa);
        this.readMemory();
        if (!this.MET.value) {
            this.IB.set(this.IB.value - this.IB.value%0x100000000 +
                        (this.C.value%0x10000)*0x10000 + this.P.value%0x10000);
            this.writeMemory();
            this.P.set(bbbb);
        }
    }

    this.ioComplete(true);
};

/**************************************/
B220Processor.prototype.magTapeSendWord = function magTapeSendWord(initial) {
    /* Sends the next of data from memory to the tape control unit, starting at
    the current operand address in the C register. "initial" is true if this
    call is the first to fetch words for a block. This causes the routine to
    save the current operand address in the control digits of C. Returns
    binary -1 if the processor has been cleared or a memory address error
    occurs, and the I/O must be aborted. Returns the BCD memory word otherwise */
    var result;                         // return value

    if (!this.AST.value) {
        result = -1;                    // we've probably been cleared
    } else {
        if (initial) {
            this.clockIn();
            this.CCONTROL = this.CADDR; // copy C address into control digits
        }

        this.E.set(this.CADDR);
        this.CADDR = this.bcdAdd(this.CADDR, 1, 4);
        this.C.set((this.CCONTROL*0x100 + this.COP)*0x10000 + this.CADDR);
        this.readMemory();
        if (this.MET.value) {           // invalid address
            result = -1;
        } else {
            result = this.IB.value;
            this.D.set(result);
            this.execClock += 0.480;    // time to transfer one word to tape
        }
    }

    return result;
};

/**************************************/
B220Processor.prototype.magTapeReceiveWord = function magTapeReceiveWord(initial, word) {
    /* Stores the next of data from the tape control unit to memory, starting at
    the current operand address in the C register. "initial" is true if this
    call is the first to store words for a block. This causes the routine to
    save the current operand address in the control digits of C. Returns
    binary -1 if the processor has been cleared or a memory address error
    occurs, and the I/O must be aborted. Returns 0 otherwise */
    var result = 0;                     // return value
    var sign;                           // sign digit

    if (!this.AST.value) {
        result = -1;                    // we've probably been cleared
    } else {
        if (initial) {
            this.clockIn();
            this.CCONTROL = this.CADDR; // copy C address into control digits
        }

        this.E.set(this.CADDR);
        this.CADDR = this.bcdAdd(this.CADDR, 1, 4);
        this.C.set((this.CCONTROL*0x100 + this.COP)*0x10000 + this.CADDR);
        this.D.set(word);
        if (this.vDigit & 0x08) {       // B-adjustment of words is enabled
            sign = (word - word%0x10000000000);
            if (sign & 0x08) {          // this word is to be B-adjusted
                word = (sign&0x07)*0x10000000000 + word%0x10000000000 -
                       word%0x100000 + this.bcdAdd(word, this.B.value, 4);
                this.C10.set(0);        // reset carry toggle
            }
        }

        this.IB.set(word);
        this.writeMemory();
        if (this.MET.value) {           // invalid address
            result = -1;
        } else {
            this.execClock += 0.480;    // time to transfer one word to tape
        }
    }

    return result;
};


/***********************************************************************
*   Fetch Module                                                       *
***********************************************************************/

/**************************************/
B220Processor.prototype.fetchWordToC = function fetchWordToC(word) {
    /* Transfers "word" to the C register, applying B-register modification
    if necessary */
    var dSign = ((word - word%0x10000000000)/0x10000000000)%2;

    this.DST.set(dSign);
    this.CADDR = word%0x10000;                                      // C address
    this.COP = (word%0x1000000 - this.CADDR)/0x10000;               // C op code
    this.CCONTROL = (word%0x10000000000 - word%0x1000000)/0x1000000;// C control digits
    if (!dSign) {
        this.C.set(word%0x10000000000);
    } else {
        this.CADDR = this.bcdAdd(this.CADDR, this.B.value, 4);
        this.C10.set(0);                                            // reset carry toggle
        this.C.set((this.CCONTROL*0x100 + this.COP)*0x10000 + this.CADDR);
    }
};

/**************************************/
B220Processor.prototype.fetch = function fetch(entryP) {
    /* Implements the Fetch cycle of the 220 processor. This is initiated either
    by pressing START on the Console with EXT=0 (Fetch), pressing STEP on the
    Console when the computer is stopped and EXT=0, during I/O when a control
    word (sign 6,7) is received from a peripheral device, or by the prior
    Operation Complete if the processor is in continuous mode. The "entryP"
    parameter indicates whether the instruction word is already in IB (true)
    or must be fetched from the address in P first (false) */
    var dSign;                          // sign bit of IB register
    var word;                           // instruction word

    if (entryP) {                       // if instruction already loaded
        word = this.IB.value;
    } else {                            // if doing normal fetch
        this.E.set(this.P.value);
        word = this.readMemory();
    }

    if (!this.MET.value) {
        // (should set IB sign bit 1=0 here, but to reduce overhead we don't bother)
        this.fetchWordToC(word);

        this.D.set(word);               // D contains a copy of memory word
        if (!entryP && !this.PCOUNTSW) {
            this.P.inc();               // if not doing I/O, bump the program counter
        }
    }

    // if we're not locked in Fetch, switch to Execute cycle next.
    if (!this.FETCHEXECUTELOCKSW) {
        this.EXT.set(1);
    }

    this.execClock += 0.090;            // fetch uniformly requires 90 us
};


/***********************************************************************
*   Execute Module                                                     *
***********************************************************************/

/**************************************/
B220Processor.prototype.execute = function execute() {
    /* Implements the Execute cycle of the 220 processor. This is initiated
    either by pressing START on the console with the EXT=1 (Execute), or by
    the prior Operation Complete if the processor is in automatic mode */
    var d;                              // scratch digit
    var w;                              // scratch word
    var x;                              // scratch variable or counter

    w = this.C.value;
    this.CCONTROL = (w - w%0x1000000)/0x1000000;        // C register control digits
    this.COP = (w%0x1000000 - w%0x10000)/0x10000;       // C register operation code
    this.CADDR = w%0x10000;                             // C register operand address
    this.opTime = 0;                                    // clear the current instruction timer

    if (this.OFT.value && this.HCT.value && this.COP != 0x31) {
        this.setStop();                 // if overflow and SOH and instruction is not BOF, stop
        return;                         // do not go through Operation Complete
    }

    this.E.set(0);
    this.IB.set(0);

    switch (this.COP) {
    case 0x00:      //--------------------- HLT     Halt
        this.setStop();
        this.opTime = 0.010;
        this.operationComplete();
        break;

    case 0x01:      //--------------------- NOP     No operation
        // do nothing
        this.opTime = 0.010;
        this.operationComplete();
        break;

    case 0x03:      //--------------------- PRD     Paper tape read
        this.opTime = 0.185;                            // just a guess...
        d = this.CCONTROL >>> 12;                       // get unit number
        if (d == 0) {
            d = 10;                                     // xlate unit 0 to unit 10
        }

        this.selectedUnit = d;
        this.rDigit = this.CCONTROL%0x10;
        this.sDigit = 1;                                // use word count in C (32)
        this.D.set(0);
        this.ioInitiate();
        d = this.console.inputUnitSelect(this.selectedUnit, this.boundConsoleInputInitiateNormal);
        if (d < 0) {                                    // no unit available -- set alarm and quit
            this.setPaperTapeCheck(1);
            this.ioComplete(true);
        }
        break;

    case 0x04:      //--------------------- PRB     Paper tape read, branch
        this.opTime = 0.185;                            // just a guess...
        d = this.CCONTROL >>> 12;                       // get unit number
        if (d == 0) {
            d = 10;                                     // xlate unit 0 to unit 10
        }

        this.selectedUnit = d;
        this.rDigit = (this.CCONTROL & 0x0E) | 1;       // force recognition of control words
        this.sDigit = 0;                                // do not use word count in C (32)
        this.D.set(0);
        this.ioInitiate();
        d = this.console.inputUnitSelect(this.selectedUnit, this.boundConsoleInputInitiateNormal);
        if (d < 0) {                                    // no unit available -- set alarm and quit
            this.setPaperTapeCheck(1);
            this.ioComplete(true);
        }
        break;

    case 0x05:      //--------------------- PRI     Paper tape read, inverse format
        this.opTime = 0.185;                            // just a guess...
        d = this.CCONTROL >>> 12;                       // get unit number
        if (d == 0) {
            d = 10;                                     // xlate unit 0 to unit 10
        }

        this.selectedUnit = d;
        this.rDigit = (this.CCONTROL & 0x0E) | 1;       // force recognition of control words
        this.sDigit = 1;                                // use word count in C (32)
        this.D.set(0);
        this.ioInitiate();
        d = this.console.inputUnitSelect(this.selectedUnit, this.boundConsoleInputInitiateInverse);
        if (d < 0) {                                    // no unit available -- set alarm and quit
            this.setPaperTapeCheck(1);
            this.ioComplete(true);
        }
        break;

    case 0x06:      //--------------------- PWR     Paper tape write
        this.opTime = 0.185;                            // just a guess...
        d = this.CCONTROL >>> 12;                       // get unit number
        if (d == 0) {
            d = 10;                                     // xlate unit 0 to unit 10
        }

        this.selectedUnit = d;
        this.ioInitiate();
        d = this.console.outputUnitSelect(d, this.boundConsoleOutputSign);
        if (d < 0) {                                    // no unit available -- set alarm and quit
            this.setPaperTapeCheck(1);
            this.ioComplete(true);
        }
        break;

    case 0x07:      //--------------------- PWI     Paper tape write interrogate, branch
        d = this.CCONTROL >>> 12;                       // get unit number
        if (d == 0) {
            d = 10;                                     // xlate unit 0 to unit 10
        }

        this.selectedUnit = d;
        d = this.console.outputUnitSelect(d, B220Processor.emptyFunction);
        if (d < 0) {                                    // if not ready, continue in sequence
            this.opTime = 0.015;
        } else {                                        // if ready, branch to operand address
            this.P.set(this.CADDR);
            this.opTime = 0.035;
        }
        this.operationComplete();
        break;

    case 0x08:      //--------------------- KAD     Keyboard add
        this.D.set(0);
        this.setStop();
        this.operationComplete();
        break;

    case 0x09:      //--------------------- SPO     Supervisory print-out
        this.opTime = 0.185;                            // just a guess...
        this.ioInitiate();
        d = this.console.outputUnitSelect(0, this.boundConsoleOutputSign);
        if (d < 0) {                                    // no unit available -- set alarm and quit
            this.setPaperTapeCheck(1);
            this.ioComplete(true);
        }
        break;

    case 0x10:      //--------------------- CAD/CAA Clear add/add absolute
        this.SUT.set(0);
        this.A.value = this.IB.value - this.IB.value%0x10000000000;     // 0 with sign of IB
        this.integerAdd(this.CCONTROL % 0x10 == 1, false);
        this.operationComplete();
        break;

    case 0x11:      //--------------------- CSU/CSA Clear subtract/subtract absolute
        this.SUT.set(1);
        this.A.value = this.IB.value - this.IB.value%0x10000000000;     // 0 with sign of IB
        this.integerAdd(this.CCONTROL % 0x10 == 1, false);
        this.operationComplete();
        break;

    case 0x12:      //--------------------- ADD/ADA Add/add absolute
        this.SUT.set(0);
        this.integerAdd(this.CCONTROL % 0x10 == 1, false);
        this.operationComplete();
        break;

    case 0x13:      //--------------------- SUB/SUA Subtract/subtract absolute
        this.SUT.set(1);
        this.integerAdd(this.CCONTROL % 0x10 == 1, false);
        this.operationComplete();
        break;

    case 0x14:      //--------------------- MUL     Multiply
        this.integerMultiply();
        this.operationComplete();
        break;

    case 0x15:      //--------------------- DIV     Divide
        this.integerDivide();
        this.operationComplete();
        break;

    case 0x16:      //--------------------- RND     Round
        this.opTime = 0.015;                            // minimum instruction timing
        this.SUT.set(0);
        w = this.A.value%0x10000000000;
        this.SGT.set(((this.A.value - w)/0x10000000000)%2);
        if (this.R.value%0x10000000000 >= 0x5000000000) {
            // Add round-off (as the carry bit) to absolute value of A.
            this.A.value -= w;                          // preserve the A sign digit
            w = this.bcdAdd(w, 0, 11, 0, 1);
            if (w >= 0x10000000000) {
                this.OFT.set(1);                        // overflow occurred
                w -= 0x10000000000;                     // remove the overflow bit from A
            }
            this.A.set(this.A.value + w);               // restore the A sign digit
            this.opTime += 0.060;                       // account for add cycle
        }
        this.R.set(0);                                  // unconditionally clear R
        this.operationComplete();
        break;

    case 0x17:      //--------------------- EXT     Extract
        this.integerExtract();
        this.operationComplete();
        break;

    case 0x18:      //--------------------- CFA/CFR Compare field A/R
        this.compareField();
        this.operationComplete();
        break;

    case 0x19:      //--------------------- ADL     Add to location
        this.SUT.set(0);
        this.integerAdd(false, true);                   // result to D register
        this.IB.set(this.D.value);
        this.writeMemory();                             // E still contains the operand address
        this.opTime += 0.70;                            // additional time over standard ADD
        this.operationComplete();
        break;

    case 0x20:      //--------------------- IBB     Increase B, branch
        w = this.B.value;
        this.B.add(this.CCONTROL);
        if (this.B.value < w) {
            this.opTime = 0.040;
        } else {
            this.P.set(this.CADDR);
            this.opTime = 0.060;
        }
        this.operationComplete();
        break;

    case 0x21:      //--------------------- DBB     Decrease B, branch
        w = this.B.value;
        this.B.sub(this.CCONTROL);
        if (this.B.value > w) {
            this.opTime = 0.040;
        } else {
            this.P.set(this.CADDR);
            this.opTime = 0.060;
        }
        this.operationComplete();
        break;

    case 0x22:      //--------------------- FAD/FAA Floating add/add absolute
        this.SUT.set(0);
        this.floatingAdd(this.CCONTROL % 0x10 == 1);
        this.operationComplete();
        break;

    case 0x23:      //--------------------- FSU/FSA Floating subtract/subtract absolute
        this.SUT.set(1);
        this.floatingAdd(this.CCONTROL % 0x10 == 1);
        this.operationComplete();
        break;

    case 0x24:      //--------------------- FMU     Floating multiply
        this.floatingMultiply();
        this.operationComplete();
        break;

    case 0x25:      //--------------------- FDV     Floating divide
        this.floatingDivide(0);
        this.operationComplete();
        break;

    case 0x26:      //--------------------- IFL     Increase field location
        this.increaseFieldLocation();
        this.operationComplete();
        break;

    case 0x27:      //--------------------- DFL     Decrease field location
        this.decreaseFieldLocation(false);
        this.operationComplete();
        break;

    case 0x28:      //--------------------- DLB     Decrease field location, load B
        this.decreaseFieldLocation(true);
        this.operationComplete();
        break;

    case 0x29:      //--------------------- RTF     Record transfer
        this.opTime = 0.040;
        do {
            d = this.bcdAdd(this.CCONTROL, 0x990, 3);   // decrement word count
            this.CCONTROL += d - this.CCONTROL%0x1000;
            this.E.set(this.CADDR);
            this.CADDR = this.bcdAdd(this.CADDR, 1, 4); // increment source address
            this.C.set((this.CCONTROL*0x100 + this.COP)*0x10000 + this.CADDR);
            this.readMemory();
            if (this.MET.value) {                       // invalid address
                break; // out of do loop
            } else {
                this.E.set(this.B.value);
                this.B.inc();                           // increment destination address
                this.opTime += 0.060;
                this.writeMemory();
                if (this.MET.value) {
                    break; // out of do loop
                }
            }
        } while (this.CCONTROL%0x1000 > 0x00F);
        this.operationComplete();
        break;

    case 0x30:      //--------------------- BUN     Branch, unconditionally
        this.P.set(this.CADDR);
        this.opTime = 0.035;
        this.operationComplete();
        break;

    case 0x31:      //--------------------- BOF     Branch, overflow
        this.opTime = 0.015;
        if (this.OFT.value) {
            this.P.set(this.CADDR);
            this.OFT.set(0);
            this.opTime += 0.020;
        }
        this.operationComplete();
        break;

    case 0x32:      //--------------------- BRP     Branch, repeat
        this.opTime = 0.015;
        if (this.RPT.value) {
            this.P.set(this.CADDR);
            this.RPT.set(0);
            this.opTime += 0.020;
        }
        this.operationComplete();
        break;

    case 0x33:      //--------------------- BSA     Branch, sign A
        this.opTime = 0.085;
        this.SUT.set(1);
        if ((this.A.value - this.A.value%0x10000000000)/0x10000000000 == this.CCONTROL%0x10) {
            this.P.set(this.CADDR);
            this.opTime += 0.020;
        }
        this.operationComplete();
        break;

    case 0x34:      //--------------------- BCH/BCL Branch, comparison high/low
        this.opTime = 0.015;
        if (this.UET.value) {
            if (this.HIT.value) {                       // HIGH condition
                if (this.CCONTROL%0x10 != 1) {          // BCH -- test for high condition
                    this.P.set(this.CADDR);
                    this.opTime += 0.020;
                }
            } else {                                    // LOW condition
                if (this.CCONTROL%0x10 == 1) {          // BCL -- test for low condition
                    this.P.set(this.CADDR);
                    this.opTime += 0.020;
                }
            }
        } else {
            if (this.HIT.value) {                       // EQUAL condition
                // continue in sequence
            } else {                                    // no condition is set
                this.setProgramCheck(1);
            }
        }
        this.operationComplete();
        break;

    case 0x35:      //--------------------- BCE/BCU Branch, comparison equal/unequal
        this.opTime = 0.015;
        if (this.UET.value) {                           // UNEQUAL condition
            if (this.CCONTROL%0x10 == 1) {              // BCU -- test for unequal condition
                this.P.set(this.CADDR);
                this.opTime += 0.020;
            } else {
                // continue in sequence
            }
        } else {
            if (this.HIT.value) {                       // EQUAL condition
                if (this.CCONTROL%0x10 != 1) {          // BCE -- test for equal condition
                    this.P.set(this.CADDR);
                    this.opTime += 0.020;
                }
            } else {                                    // no condition is set
                this.setProgramCheck(1);
            }
        }
        this.operationComplete();
        break;

    case 0x36:      //--------------------- BFA     Branch, field A
        this.branchField(this.A.value);
        this.operationComplete();
        break;

    case 0x37:      //--------------------- BFR     Branch, field R
        this.branchField(this.R.value);
        this.operationComplete();
        break;

    case 0x38:      //--------------------- BCS     Branch, control switch
        this.opTime = 0.015;                            // minimum instruction timing
        d = (this.CCONTROL - this.CCONTROL%0x1000)/0x1000;
        if (this["PCS" + d.toString() + "SW"]) {
            this.opTime += 0.020;
            this.P.set(this.CADDR);
        }
        this.operationComplete();
        break;

    case 0x39:      //--------------------- SOR/SOH/IOM Set overflow remember/halt, Interrogate overflow mode
        // Note: it's not clear what should happen if the variant digit (41) is
        // other than 0, 1, or 2. We assume the digit is used as a bit mask.
        this.opTime = 0.015;
        switch (true) {
        case (this.CCONTROL & 0x02) == 0x02:            // IOM: Interrogate overflow mode
            if (this.HCT.value) {
                this.P.set(this.CADDR);
                this.opTime += 0.020;
            }
            break;
        case (this.CCONTROL & 0x01) == 0x01:            // SOH: Set overflow halt
            this.HCT.set(1);
            if (this.OFT.value) {
                this.setStop();
            }
            break;
        default:                                        // SOR: Set overflow remember
            this.HCT.set(0);
            break;
        }
        this.operationComplete();
        break;

    case 0x40:      //--------------------- ST*     Store A/R/B
        this.storeRegister();
        this.operationComplete();
        break;

    case 0x41:      //--------------------- LDR     Load R
        this.opTime = 0.085;
        this.E.set(this.CADDR);
        this.readMemory();
        if (!this.MET.value) {
            this.D.set(this.IB.value);
            this.R.set(this.IB.value);
        }
        this.operationComplete();
        break;

    case 0x42:      //--------------------- LDB/LBC Load B/B complement
        this.opTime = 0.090;
        this.E.set(this.CADDR);
        this.readMemory();
        if (!this.MET.value) {
            this.D.set(this.IB.value);
            if (this.CCONTROL%0x10 == 1) {              // Load B complement
                this.B.set(this.bcdAdd(this.IB.value, 0, 4, 1, 1));
            } else {                                    // Load B
                this.B.set(this.IB.value);
            }
        }
        this.operationComplete();
        break;

    case 0x43:      //--------------------- LSA     Load sign A
        this.opTime = 0.015
        this.A.set(this.A.value%0x10000000000 + (this.CCONTROL%0x10)*0x10000000000);
        this.operationComplete();
        break;

    case 0x44:      //--------------------- STP     Store P
        this.opTime = 0.095;
        this.E.set(this.CADDR);
        this.readMemory();
        if (!this.MET.value) {
            this.IB.set(this.IB.value - this.IB.value%0x10000 + this.bcdAdd(this.P.value, 1, 4));
            this.D.set(this.IB.value);
            this.writeMemory();
        }
        this.operationComplete();
        break;

    case 0x45:      //--------------------- CL*     Clear A/R/B
        this.opTime = 0.010;
        if (this.CCONTROL & 0x01) {
            this.A.set(0);
        }
        if (this.CCONTROL & 0x02) {
            this.R.set(0);
        }
        if (this.CCONTROL & 0x04) {
            this.B.set(0);
        }
        this.operationComplete();
        break;

    case 0x46:      //--------------------- CLL     Clear location
        this.opTime = 0.025;
        this.E.set(this.CADDR);
        this.writeMemory();                             // IB is still zero
        this.operationComplete();
        break;

    case 0x48:      //--------------------- SR*     Shift right A/A and R/A with sign
        x = B220Processor.bcdBinary(this.CADDR % 0x20);
        this.opTime = 0.020 + x*0.005;
        this.DC.set(B220Processor.binaryBCD(20-x));
        switch (this.CCONTROL%0x10) {
        case 1:         // SRT: Shift Right A and R
            w = this.A.value % 0x10000000000;           // A sign is not affected
            this.R.value %= 0x10000000000;              // discard the R sign
            while (this.DC.value < 0x20) {
                d = w % 0x10;
                w = (w-d)/0x10;
                this.R.value = (this.R.value - this.R.value%0x10)/0x10 + d*0x1000000000;
                this.DC.inc();
            }
            this.R.set(this.A.value - this.A.value%0x10000000000 + this.R.value); // copy A sign into R
            this.A.set(this.A.value - this.A.value%0x10000000000 + w);  // restore the A sign
            break;
        case 2:         // SRS: Shift Right A with Sign
            w = this.A.value % 0x100000000000;          // A sign is included
            while (this.DC.value < 0x20) {
                d = w % 0x10;
                w = (w-d)/0x10;
                this.DC.inc();
            }
            this.A.set(w);
            break;
        default:        // SRA: Shift Right A
            w = this.A.value % 0x10000000000;           // A sign is not affected
            while (this.DC.value < 0x20) {
                d = w % 0x10;
                w = (w-d)/0x10;
                this.DC.inc();
            }
            this.A.set(this.A.value - this.A.value%0x10000000000 + w);  // restore the A sign
            break;
        } // switch on control digit
        this.operationComplete();
        break;

    case 0x49:      //--------------------- SL*     Shift (rotate) left A/A and R/A with sign
        switch (this.CCONTROL%0x10) {
        case 1:         // SLT: Shift Left A and R
            x = B220Processor.bcdBinary(this.CADDR % 0x20);
            this.opTime = 0.210 - x*0.005;
            this.DC.set(B220Processor.binaryBCD(x));
            w = this.R.value % 0x10000000000;           // R sign is not affected
            this.A.value %= 0x10000000000;              // discard the A sign
            while (this.DC.value < 0x20) {
                d = w % 0x10;
                w = (w-d)/0x10 + (this.A.value%0x10)*0x1000000000;
                this.A.value = (this.A.value - this.A.value%0x10)/0x10 + d*0x1000000000;
                this.DC.inc();
            }
            this.A.set(this.R.value - this.R.value%0x10000000000 + this.A.value);  // copy R sign into A
            this.R.set(this.R.value - this.R.value%0x10000000000 + w); // restore the R sign
            break;
        case 2:         // SLS: Shift Left A with Sign
            x = B220Processor.bcdBinary(this.CADDR % 0x10);
            this.opTime = 0.160 - x*0.005;
            this.DC.set(B220Processor.binaryBCD(10+x));
            w = this.A.value % 0x100000000000;          // A sign is included
            while (this.DC.value < 0x20) {
                d = w % 0x10;
                w = (w-d)/0x10 + d*0x10000000000;
                this.DC.inc();
            }
            this.A.set(w);
            break;
        default:        // SLA: Shift Left A
            x = B220Processor.bcdBinary(this.CADDR % 0x10);
            this.opTime = 0.160 - x*0.005;
            this.DC.set(B220Processor.binaryBCD(10+x));
            w = this.A.value % 0x10000000000;           // A sign is not affected
            while (this.DC.value < 0x20) {
                d = w % 0x10;
                w = (w-d)/0x10 + d*0x1000000000;
                this.DC.inc();
            }
            this.A.set(this.A.value - this.A.value%0x10000000000 + w);  // restore the A sign
            break;
        } // switch on control digit
        this.operationComplete();
        break;

    case 0x50:      //--------------------- MTS/MFS/MLS/MRW/MDA  Magnetic tape search/field search/lane select/rewind
        this.opTime = 0.160;
        if (!this.magTape) {
            this.setMagneticTapeCheck(true);                // no tape control
            this.operationComplete();
        } else {
            this.selectedUnit = (this.CCONTROL >>> 12)%0x10;
            this.vDigit = this.CCONTROL%0x10;
            this.ioInitiate();
            if (this.vDigit & 0x08) {                       // MRW/MDA: rewind, with or without lockout
                this.magTape.rewind(this.D.value, this.boundMagTapeComplete, this.boundMagTapeSendWord);
            } else if (this.vDigit & 0x04) {                // MLS: lane select
                this.magTape.laneSelect(this.D.value, this.boundMagTapeComplete, this.boundMagTapeSendWord);
            } else {                                        // MTS/MFS: search or field search
                if (this.D.value%0x80000000000 < 0x40000000000) {       // full-word search
                    this.magTape.search(this.D.value, this.boundMagTapeComplete, 0, this.boundMagTapeSendWord);
                } else {                                                // partial-word search based on sL in B
                    this.magTape.search(this.D.value, this.boundMagTapeComplete, this.B.value, this.boundMagTapeSendWord);
                }
            }
        }
        break;

    case 0x51:      //--------------------- MTC/MFC Magnetic tape scan/field scan
        this.setProgramCheck(1);
        this.operationComplete();
        break;

    case 0x52:      //--------------------- MRD     Magnetic tape read
        this.opTime = 0.160;
        if (!this.magTape) {
            this.setMagneticTapeCheck(true);                // no tape control
            this.operationComplete();
        } else {
            this.selectedUnit = (this.CCONTROL >>> 12)%0x10;
            this.vDigit = this.CCONTROL%0x10;
            this.ioInitiate();
            this.magTape.read(this.D.value, this.boundMagTapeComplete, false, this.boundMagTapeReceiveWord);
        }
        break;

    case 0x53:      //--------------------- MRR     Magnetic tape read, record
        this.opTime = 0.160;
        if (!this.magTape) {
            this.setMagneticTapeCheck(true);                // no tape control
            this.operationComplete();
        } else {
            this.selectedUnit = (this.CCONTROL >>> 12)%0x10;
            this.vDigit = this.CCONTROL%0x10;
            this.ioInitiate();
            this.magTape.read(this.D.value, this.boundMagTapeComplete, true, this.boundMagTapeReceiveWord);
        }
        break;

    case 0x54:      //--------------------- MIW     Magnetic tape initial write
        this.opTime = 0.160;
        if (!this.magTape) {
            this.setMagneticTapeCheck(true);                // no tape control
            this.operationComplete();
        } else {
            this.selectedUnit = (this.CCONTROL >>> 12)%0x10;
            this.ioInitiate();
            this.magTape.initialWrite(this.D.value, this.boundMagTapeComplete, false, this.boundMagTapeSendWord);
        }
        break;

    case 0x55:      //--------------------- MIR     Magnetic tape initial write, record
        this.opTime = 0.160;
        if (!this.magTape) {
            this.setMagneticTapeCheck(true);                // no tape control
            this.operationComplete();
        } else {
            this.selectedUnit = (this.CCONTROL >>> 12)%0x10;
            this.ioInitiate();
            this.magTape.initialWrite(this.D.value, this.boundMagTapeComplete, true, this.boundMagTapeSendWord);
        }
        break;

    case 0x56:      //--------------------- MOW     Magnetic tape overwrite
        this.opTime = 0.160;
        if (!this.magTape) {
            this.setMagneticTapeCheck(true);                // no tape control
            this.operationComplete();
        } else {
            this.selectedUnit = (this.CCONTROL >>> 12)%0x10;
            this.ioInitiate();
            this.magTape.overwrite(this.D.value, this.boundMagTapeComplete, false, this.boundMagTapeSendWord);
        }
        break;

    case 0x57:      //--------------------- MOR     Magnetic tape overwrite, record
        this.opTime = 0.160;
        if (!this.magTape) {
            this.setMagneticTapeCheck(true);                // no tape control
            this.operationComplete();
        } else {
            this.selectedUnit = (this.CCONTROL >>> 12)%0x10;
            this.ioInitiate();
            this.magTape.overwrite(this.D.value, this.boundMagTapeComplete, true, this.boundMagTapeSendWord);
        }
        break;

    case 0x58:      //--------------------- MPF/MPB/MIE Magnetic tape position forward/backward/at end
        this.opTime = 0.130;
        if (!this.magTape) {
            this.setMagneticTapeCheck(true);                // no tape control
            this.operationComplete();
        } else {
            this.selectedUnit = (this.CCONTROL >>> 12)%0x10;
            this.ioInitiate();
            switch (this.CCONTROL%0x10) {
            case 1:                                         // MPB: position tape backward
                this.magTape.positionBackward(this.D.value, this.boundMagTapeComplete);
                break;
            case 2:                                         // MPE: position tape at end
                this.magTape.positionAtEnd(this.D.value, this.boundMagTapeComplete);
                break;
            default:                                        // MPF: position tape forward
                this.magTape.positionForward(this.D.value, this.boundMagTapeComplete);
                break;
            } // switch on operation variant
        }
        break;

    case 0x59:      //--------------------- MIB/MIE Magnetic tape interrogate, branch/end of tape, branch
        if (!this.magTape) {
            this.opTime = 0.01;
        } else if (this.magTape.controlBusy) {
            this.opTime = 0.01;
        } else {
            opTime = 0.14;
            if (this.CCONTROL%0x10 == 1) {              // MIE
                if (this.magTape.testUnitAtMagneticEOT(this.D.value)) {
                    this.P.set(this.CADDR);
                    this.opTime += 0.020;
                }
            } else {                                    // MIB
                if (this.magTape.testUnitReady(this.D.value)) {
                    this.P.set(this.CADDR);
                    this.opTime += 0.020;
                }
            }
        }
        this.operationComplete();
        break;

    case 0x60:      //--------------------- CRD     Card read
        this.opTime = 1.600;                            // rough minimum estimage
        this.E.set(this.CADDR);
        this.D.set(0);
        if (!this.cardatron) {
            this.setCardatronCheck(1);
            this.operationComplete();
        } else {
            this.selectedUnit = (this.CCONTROL >>> 12)%0x10;
            this.rDigit = this.CCONTROL%0x10;
            this.vDigit = (this.CCONTROL >>> 4)%0x10;
            this.ioInitiate();
            d = this.cardatron.inputInitiate(this.selectedUnit, this.rDigit, this.boundCardatronReceiveWord);
            if (d < 0) {                                // invalid unit
                this.setCardatronCheck(1);
                this.ioComplete(true);
            }
        }
        break;

    case 0x61:      //--------------------- CWR     Card write
        this.opTime = 1.600;                            // rough minimum estimage
        this.E.set(this.CADDR);
        this.D.set(0);
        if (!this.cardatron) {
            this.setCardatronCheck(1);
            this.operationComplete();
        } else {
            this.selectedUnit = (this.CCONTROL >>> 12)%0x10;
            this.rDigit = this.CCONTROL%0x10;
            this.vDigit = (this.CCONTROL >>> 4)%0x10;
            this.ioInitiate();
            d = this.cardatron.outputInitiate(this.selectedUnit, this.rDigit, this.vDigit,
                        this.boundCardatronOutputWord, this.boundCardatronOutputFinished);
            if (d < 0) {                                // invalid unit
                this.setCardatronCheck(1);
                this.ioComplete(true);
            }
        }
        break;

    case 0x62:      //--------------------- CRF     Card read, format load
        this.opTime = 1.600;                            // rough minimum estimage
        this.E.set(this.CADDR);
        this.D.set(0);
        if (!this.cardatron) {
            this.setCardatronCheck(1);
            this.operationComplete();
        } else {
            this.selectedUnit = (this.CCONTROL >>> 12)%0x10;
            this.rDigit = this.CCONTROL%0x10;
            this.ioInitiate();
            d = this.cardatron.inputFormatInitiate(this.selectedUnit, this.rDigit,
                        this.boundCardatronOutputWord, this.boundCardatronOutputFinished);
            if (d < 0) {                                // invalid unit
                this.setCardatronCheck(1);
                this.ioComplete(true);
            }
        }
        break;

    case 0x63:      //--------------------- CWF     Card write, format load
        this.opTime = 1.600;                            // rough minimum estimage
        this.E.set(this.CADDR);
        this.D.set(0);
        if (!this.cardatron) {
            this.setCardatronCheck(1);
            this.operationComplete();
        } else {
            this.selectedUnit = (this.CCONTROL >>> 12)%0x10;
            this.rDigit = this.CCONTROL%0x10;
            this.ioInitiate();
            d = this.cardatron.outputFormatInitiate(this.selectedUnit, this.rDigit,
                        this.boundCardatronOutputWord, this.boundCardatronOutputFinished);
            if (d < 0) {                                // invalid unit
                this.setCardatronCheck(1);
                this.ioComplete(true);
            }
        }
        break;

    case 0x64:      //--------------------- CRI     Card read interrogate, branch
        this.opTime = 0.265;                            // average
        this.E.set(this.CADDR);
        this.D.set(0);
        if (!this.cardatron) {
            this.setCardatronCheck(1);
        } else {
            this.selectedUnit = (this.CCONTROL >>> 12)%0x10;
            d = this.cardatron.inputReadyInterrogate(this.selectedUnit);
            if (d < 0) {                                // invalid unit
                this.setCardatronCheck(1);
            } else if (d > 0) {
                this.opTime += 0.020;
                this.P.set(this.CADDR);
            }
        }
        this.operationComplete();
        break;

    case 0x65:      //--------------------- CWI     Card write interrogate, branch
        this.opTime = 0.265;                            // average
        this.E.set(this.CADDR);
        this.D.set(0);
        if (!this.cardatron) {
            this.setCardatronCheck(1);
        } else {
            this.selectedUnit = (this.CCONTROL >>> 12)%0x10;
            d = this.cardatron.outputReadyInterrogate(this.selectedUnit);
            if (d < 0) {                                // invalid unit
                this.setCardatronCheck(1);
            } else if (d > 0) {
                this.opTime += 0.020;
                this.P.set(this.CADDR);
            }
        }
        this.operationComplete();
        break;

    case 0x66:      //--------------------- HPW     High speed printer write
        this.setProgramCheck(1);
        this.operationComplete();
        break;

    case 0x67:      //--------------------- HPI     High speed printer interrogate, branch
        this.setProgramCheck(1);
        this.operationComplete();
        break;

    default:        //--------------------- Invalid op code -- set Program Check alarm
        this.setProgramCheck(1);
        this.operationComplete();
        break;
    } // switch this.COP
};


/***********************************************************************
*   Processor Run Control                                              *
***********************************************************************/

/**************************************/
B220Processor.prototype.operationComplete = function operationComplete() {
    /* Implements Operation Complete for the Execute cycle. If we're not locked
    in Execute, switch to Fetch cycle next */

    if (this.FETCHEXECUTELOCKSW != 1) {
        this.EXT.set(0);                // set to FETCH state
    }

    this.execClock += this.opTime;
    if (this.ORDERCOMPLEMENTSW) {
        this.C.flipBit(16);             // complement low order bit of op code
        this.COP ^= 0x01;
    }

    if (!this.RUT.value) {              // halted
        this.stop();
    } else if (this.SST.value) {
        this.stop();                    // single-stepping
    } else if (this.SONSW) {
        if (this.STOCSW) {              // check for post-execute S-to-C stop
            if (this.SUNITSSW) {
                if (this.C.value%0x10 == this.S.value%0x10) {
                    this.stop();
                }
            } else if (this.C.value%0x10000 == this.S.value) {
                this.stop();
            }
        }
    }
};

/**************************************/
B220Processor.prototype.ioComplete = function ioComplete(restart) {
    /* Implements completion of the Execute cycle for an I/O instruction that
    has been executing asynchronously. If "restart" is true, the Processor will
    resume automatic operation */

    this.AST.set(0);
    this.clockIn();
    while (this.procTime < 0) {
        this.procTime += this.execClock;
    }

    this.operationComplete();
    if (restart && this.RUT.value) {
        this.schedule();
    }
};

/**************************************/
B220Processor.prototype.ioInitiate = function ioInitiate() {
    /* Initiates asynchronous mode of the processor for I/O */

    this.AST.set(1);
    this.updateGlow(1);                 // update the console lamps
    this.execLimit = 0;                 // kill the run() loop
};

/**************************************/
B220Processor.prototype.run = function run() {
    /* Main execution control loop for the processor. Called from this.schedule()
    to initiate a time slice. Will continue fetch/execute cycles until the time
    slice expires, a stop condition is detected, or AST (asynchronous toggle)
    is set indicating the processor has been suspended during an I/O. This
    routine effectively implements Operation Complete (O.C.) for the Fetch and
    Execute cycles, although it is more of a "ready for next operation" function,
    determining if there is a stop condition, or whether to do a Fetch or
    Execute cycle next. The fetch() and execute() methods exit back here, and
    in most cases we simply step to the next cycle. In the case of asynchronous
    operation, however, we simply exit, and the I/O interface will call
    this.schedule() to restart execution again once memory transfers have
    completed */

    this.execLimit = this.execClock + B220Processor.timeSlice;

    do {
        if (this.EXT.value) {           // enter EXECUTE cycle
            this.execute();
        } else {                        // enter FETCH cycle
            if (this.SONSW) {                   // check for post-fetch S-to-P stop
                if (this.STOPSW) {              // must check before P is incremented in fetch()
                    if (this.SUNITSSW) {
                        if (this.P.value%0x10 == this.S.value%0x10) {
                            this.stop();
                        }
                    } else if (this.P.value == this.S.value) {
                        this.stop();
                    }
                }
            }

            this.fetch(false);
            if (this.SST.value) {
                this.stop();                    // single-stepping
            }
            break;
        }
    } while (this.execClock < this.execLimit);
};

/**************************************/
B220Processor.prototype.schedule = function schedule() {
    /* Schedules the next processor time slice and attempts to throttle
    performance to approximate that of a real B220. It establishes a time slice
    in terms of a number milliseconds each and calls run() to execute for at
    most that amount of time. run() counts up instruction times until it reaches
    this limit or some terminating event (such as a stop), then exits back here.
    If the processor remains active, this routine will reschedule itself after
    an appropriate delay, thereby throttling the performance and allowing other
    modules to share the single Javascript execution thread */
    var delayTime;                      // delay from/until next run() for this processor, ms
    var stamp = performance.now();      // ending time for the delay and the run() call, ms

    this.scheduler = 0;

    // If run() has been called by a throttling delay, compute the delay stats.
    if (this.delayLastStamp > 0) {
        delayTime = stamp - this.delayLastStamp;
        this.procSlack += delayTime;

        // Compute the exponential weighted average of scheduling delay.
        this.delayDeltaAvg = (delayTime - this.delayRequested)*B220Processor.delayAlpha +
                             this.delayDeltaAvg*B220Processor.delayAlpha1;
        this.procSlackAvg = delayTime*B220Processor.slackAlpha +
                            this.procSlackAvg*B220Processor.slackAlpha1;
    }

    // Execute the time slice.
    this.procTime -= this.execClock;        // prepare to accumulate internal processor time
    this.runStamp = stamp;                  // starting clock time for time slice

    this.run();

    stamp = performance.now();
    this.procRunAvg = (stamp - this.runStamp)*B220Processor.slackAlpha +
                      this.procRunAvg*B220Processor.slackAlpha1;

    // Determine what to do next.
    if (!this.RUT.value) {
        // Processor is stopped, just inhibit delay averaging on next call and exit.
        this.delayLastStamp = 0;
        this.procTime += this.execClock;    // accumulate internal processor time for the slice
    } else if (this.AST.value) {
        // Processor is idle during I/O, but still accumulating clocks.
        this.delayLastStamp = 0;
    } else {
        this.procTime += this.execClock;    // accumulate internal processor time for the slice

        // The processor is still running, so schedule next time slice after a
        // throttling delay. delayTime is the number of milliseconds the
        // processor is running ahead of real-world time. Web browsers have a
        // certain minimum setTimeout() delay. If the delay is less than our
        // estimate of that minimum, setCallback() will yield to the event loop
        // but otherwise continue (real time should eventually catch up -- we
        // hope). If the delay is greater than the minimum, setCallback() will
        // reschedule us after that delay.

        delayTime = this.execClock - stamp;
        this.delayRequested = delayTime;
        this.delayLastStamp = stamp;
        this.scheduler = setCallback(this.mnemonic, this, delayTime, this.schedule);
    }
};

/**************************************/
B220Processor.prototype.start = function start() {
    /* Initiates a time slice for the processor according to the EXT state */
    var stamp = performance.now();

    if (this.poweredOn && !this.RUT.value && !this.AST.value &&
                          !this.digitCheckAlarm.value &&
                          !this.ALT.value && !this.MET.value &&
                          !this.TAT.value && !this.CRT.value &&
                          !this.PAT.value && !this.HAT.value &&
                          !this.systemNotReady.value && !this.computerNotReady.value) {
        this.procStart = stamp;
        this.execClock = stamp;
        this.delayLastStamp = 0;
        this.delayRequested = 0;
        this.RUT.set(1);

        // Start the run timer
        while (this.runTimer >= 0) {
            this.runTimer -= stamp;
        }

        this.updateGlow(1);
        this.schedule();
    }
};

/**************************************/
B220Processor.prototype.stop = function stop() {
    /* Stops running the processor on the Javascript thread */
    var stamp = performance.now();

    if (this.poweredOn) {
        this.execLimit = 0;             // kill the time slice
        this.SST.set(0);
        this.RUT.set(0);
        this.AST.set(0);

        // Stop the timers
        this.clockIn();
        while (this.procTime < 0) {
            this.procTime += this.execClock;
        }
        while (this.runTimer < 0) {
            this.runTimer += stamp;
        }

        this.updateGlow(1);             // freeze state in the lamps
        if (this.scheduler) {
            clearCallback(this.scheduler);
            this.scheduler = 0;
        }
    }
};

/**************************************/
B220Processor.prototype.step = function step() {
    /* Single-steps the processor. This will execute the next Fetch or Execute
    cycle only, then stop the processor */

    if (this.poweredOn) {
        if (!this.RUT.value) {
            this.SST.set(1);
            this.start();
        }
    }
};

/**************************************/
B220Processor.prototype.setStop = function setStop() {
    /* Initiates a halt of the processor. The processor will execute through
    the end of the Execute cycle, then stop */

    if (this.poweredOn) {
        if (this.RUT.value) {
            this.RUT.set(0);
        } else {
            this.stop();
        }
    }
};

/**************************************/
B220Processor.prototype.setCycle = function setCycle(cycle) {
    /* Sets the processor cycle to Fetch (0) or Execute (1) */

    if (this.poweredOn) {
        if (!this.RUT.value) {
            this.EXT.set(cycle);
        }
    }
};

/**************************************/
B220Processor.prototype.toggleCompare = function toggleCompare(condition) {
    /* Toggles the comparison lamps and sets the processor UET and HIT toggles
    according to the condition: <0=LOW, 0=EQUAL, >0=HIGH */

    if (this.poweredOn) {
        if (condition < 0) {            // LOW
            this.compareLowLamp.flip();
            this.compareEqualLamp.set(0);
            this.compareHighLamp.set(0);
            this.UET.set(this.compareLowLamp.value);
            this.HIT.set(0);
        } else if (condition > 0) {     // HIGH
            this.compareLowLamp.set(0);
            this.compareEqualLamp.set(0);
            this.compareHighLamp.flip();
            this.UET.set(this.compareHighLamp.value);
            this.HIT.set(this.compareHighLamp.value);
        } else {                        // EQUAL
            this.compareLowLamp.set(0);
            this.compareEqualLamp.flip();
            this.compareHighLamp.set(0);
            this.UET.set(0);
            this.HIT.set(this.compareEqualLamp.value);
        }
    }
};

/**************************************/
B220Processor.prototype.resetRunTimer = function resetRunTimer() {
    /* Resets the elapsed run-time timer to zero */

    if (this.poweredOn) {
        if (this.runTimer < 0) {        // it's running, adjust its bias
            this.runTimer = -performance.now();
        } else {                        // it's stopped, just zero it
            this.runTimer = 0;
        }
    }
};

/**************************************/
B220Processor.prototype.resetTransfer = function resetTransfer() {
    /* Initiates a Reset and Transfer operation, storing P in address 0000/04
    and C in 0000/64, then branching to address 0001. Always active, even
    when running */

    if (this.poweredOn) {
        this.E.set(0x0000);
        this.readMemory();
        this.IB.set(this.IB.value - this.IB.value % 0x100000000 +
                    (this.C.value % 0x10000)*0x10000 + this.P.value % 0x10000);
        this.writeMemory();
        this.P.set(0x0001);
        this.EXT.set(0);                    // set to Fetch cycle
        if (!this.RUT.value) {
            this.start();
        }
    }
};

/**************************************/
B220Processor.prototype.tcuClear = function tcuClear() {
    /* Clears the Tape Control Unit */

    if (this.poweredOn) {
        if (this.magTape) {
            this.magTape.clearUnit();
        }
    }
};

/**************************************/
B220Processor.prototype.powerUp = function powerUp() {
    /* Powers up the system */

    if (!this.poweredOn) {
        this.clear();
        this.poweredOn = 1;
        this.procTime = this.runTimer = 0;
        this.procSlack = this.procSlackAvg = this.procRunAvg = 0;
        this.delayDeltaAvg = this.delayRequested = 0;

        this.console = this.devices.ControlConsole;
        this.cardatron = this.devices.CardatronControl;
        this.magTape = this.devices.MagTapeControl;
        this.computerNotReady.set(1);   // initial state after power-up
        this.updateGlow(1);
    }
};

/**************************************/
B220Processor.prototype.powerDown = function powerDown() {
    /* Powers down the system */

    if (this.poweredOn) {
        this.stop();
        this.clear();
        this.poweredOn = 0;
        this.updateGlow(1);

        this.cardatron = null;
        this.console = null;
        this.magTape = null;
        if (this.glowTimer) {
            clearInterval(this.glowTimer);
            this.glowTimer = null;
        }
    }
};

/**************************************/
B220Processor.prototype.loadDefaultProgram = function loadDefaultProgram() {
    /* Loads a set of default demo programs to the memory drum */

    // TEMP // Tape tests
    this.MM[   0] = 0x1008500000;       // MRW     1
    this.MM[   1] = 0x1002580000;       // MPE     1
    this.MM[   2] = 0x1000540000;       // MIW     0,1,10,100
    this.MM[   3] = 0x1750540100;       // MIW     100,1,7,50
    this.MM[   4] = 0x1500550079;       // MIR     79,1,5,00
    this.MM[   5] = 0x1101542000;       // MIW     2000,1,1,1   // write control block

    this.MM[   6] = 0x1008500000;       // MRW     1
    this.MM[   7] = 0x1000560000;       // MOW     0,1,10,100
    this.MM[   8] = 0x1750560100;       // MOW     100,1,7,50
    this.MM[   9] = 0x1500570079;       // MOR     79,1,5,00
    this.MM[  10] = 0x1101012000;       // MOW     2000,1,1,1   // TEMP: changed to a NOP

    this.MM[  11] = 0x1008500000;       // MRW     1
    this.MM[  12] = 0x1000523000;       // MRD     3000,1,10,0
    this.MM[  13] = 0x1700524000;       // MRD     4000,1,7,0
    this.MM[  14] = 0x1500534350;       // MRR     4350,1,5,0
    this.MM[  15] = 0x1100534800;       // MRR     4800,1,1,0   // should be a control block

    this.MM[  16] = 0x1009500000;       // MDA     1
    this.MM[  17] = 0x7777009999;       // HLT     9999,7777

    this.MM[  79] = 0x1900000000;       // preface for 19 words, 80-98
    this.MM[  99] = 0x4000000000;       // preface for 40 words, 100-139
    this.MM[ 140] = 0x5800000000;       // preface for 58 words, 141-198
    this.MM[ 199] = 0x9900000000;       // preface for 99 words, 200-298
    this.MM[ 299] = 0x0000000000;       // preface for 100 words, 300-399

    this.MM[2000] = 0x9920012002;       // end-of-tape control word
    this.MM[2001] = 0x9999999999;       // storage for end-of-tape block state
    this.MM[2002] = 0x9999008421;       // HLT: target for end-of-tape control branch

    // Simple counter speed test
    this.MM[  80] = 0x0000120082;       // ADD    82
    this.MM[  81] = 0x0000300080;       // BUN    80
    this.MM[  82] = 0x0000000001;       // CNST    1

    // Hello World
    this.MM[  90] = 0x0030090092;       // SPO    92
    this.MM[  91] = 0x0000009999;       // HLT  9999
    this.MM[  92] = 0x21648455353;      // LIT  R'HELL'
    this.MM[  93] = 0x25600665659;      // LIT  'O WOR'
    this.MM[  94] = 0x25344000016;      // LIT  'LD  'R

    // Tom Sawyer's "Square Roots 100" adapted from the 205 for the 220 (Babylonian or Newton's method):
    this.MM[ 100] = 0x0000100139;       // CAD   139
    this.MM[ 101] = 0x0000400138;       // STA   138
    this.MM[ 102] = 0x0000100139;       // CAD   139
    this.MM[ 103] = 0x0002450000;       // CLR
    this.MM[ 104] = 0x0001480005;       // SRT   5
    this.MM[ 105] = 0x0000150138;       // DIV   138
    this.MM[ 106] = 0x0000400137;       // STA   137
    this.MM[ 107] = 0x0000130138;       // SUB   138
    this.MM[ 108] = 0x0000400136;       // STA   136
    this.MM[ 109] = 0x0001100136;       // CAA   136
    this.MM[ 110] = 0x0000180135;       // CFA   135
    this.MM[ 111] = 0x0001340119;       // BCL   119
    this.MM[ 112] = 0x0000100138;       // CAD   138
    this.MM[ 113] = 0x0000120137;       // ADD   137
    this.MM[ 114] = 0x0002450000;       // CLR
    this.MM[ 115] = 0x0001480005;       // SRT   5
    this.MM[ 116] = 0x0000150134;       // DIV   134
    this.MM[ 117] = 0x0000400138;       // STA   138
    this.MM[ 118] = 0x0000300102;       // BUN   102
    this.MM[ 119] = 0x5011090139;       // SPO   139
    this.MM[ 120] = 0x5011090137;       // SPO   137
    this.MM[ 121] = 0x0010090132;       // SPO   132
    this.MM[ 122] = 0x0000100139;       // CAD   139
    this.MM[ 123] = 0x0000120133;       // ADD   133
    this.MM[ 124] = 0x0000400139;       // STA   139
    this.MM[ 125] = 0x0000300102;       // BUN   102
    this.MM[ 126] = 0;
    this.MM[ 127] = 0;
    this.MM[ 128] = 0;
    this.MM[ 129] = 0;
    this.MM[ 130] = 0;
    this.MM[ 131] = 0;
    this.MM[ 132] = 0x20000000016;      // carraige return
    this.MM[ 133] = 0x100000;
    this.MM[ 134] = 0x200000;
    this.MM[ 135] = 0x10;
    this.MM[ 136] = 0;
    this.MM[ 137] = 0;
    this.MM[ 138] = 0;
    this.MM[ 139] = 0x200000;

    // "Square Roots 100" adapted for floating-point and relative precision:
    this.MM[ 200] = 0x0000100239;       // CAD   239    load initial argument
    this.MM[ 201] = 0x0000400238;       // STA   238    store as initial upper bound
    this.MM[ 202] = 0x0000100239;       // CAD   239    start of loop: load current argument
    this.MM[ 203] = 0x0002450000;       // CR           clear R
    this.MM[ 204] = 0x0000250238;       // FDV   238    divide argument by upper bound
    this.MM[ 205] = 0x0000400237;       // STA   237    store as current result
    this.MM[ 206] = 0x0000250238;       // FDV   238    ratio to upper bound
    this.MM[ 207] = 0x0000400236;       // STA   236    store as current precision
    this.MM[ 208] = 0x0001100235;       // CAA   235    load target precision
    this.MM[ 209] = 0x0000230236;       // FSU   236    subtract current precision
    this.MM[ 210] = 0x0001330218;       // BSA   218,1  if current precision > target precision
    this.MM[ 211] = 0x0000010000;       // NOP              we're done -- jump out to print
    this.MM[ 212] = 0x0000100238;       // CAD   238    load current upper bound
    this.MM[ 213] = 0x0000220237;       // FAD   237    add current result
    this.MM[ 214] = 0x0002450000;       // CR           clear R
    this.MM[ 215] = 0x0000250234;       // FDV   234    divide by 2.0 to get new upper bound
    this.MM[ 216] = 0x0000400238;       // STA   238    store new upper bound
    this.MM[ 217] = 0x0000300202;       // BUN   202    do another iteration
    this.MM[ 218] = 0x8011090239;       // SPO   239
    this.MM[ 219] = 0x8011090237;       // SPO   237
    this.MM[ 220] = 0x0010090232;       // SPO   232
    this.MM[ 221] = 0x0000010000;       // NOP
    this.MM[ 222] = 0x0000100239;       // CAD   239    load argument value
    this.MM[ 223] = 0x0000220233;       // FAD   233    add 1 to argument value
    this.MM[ 224] = 0x0000400239;       // STA   239
    this.MM[ 225] = 0x0000300201;       // BUN   201    start sqrt for next argument value
    this.MM[ 226] = 0;
    this.MM[ 227] = 0;
    this.MM[ 228] = 0;
    this.MM[ 229] = 0;
    this.MM[ 230] = 0;
    this.MM[ 231] = 0;
    this.MM[ 232] = 0x20202020216;      // carriage return
    this.MM[ 233] = 0x05110000000;      // 1.0 literal: argument increment
    this.MM[ 234] = 0x05120000000;      // 2.0 literal
    this.MM[ 235] = 0x05099999990;      // 0.99999990 literal: target precision
    this.MM[ 236] = 0;                  // current precision
    this.MM[ 237] = 0;                  // current sqrt result
    this.MM[ 238] = 0;                  // current upper bound on result
    this.MM[ 239] = 0x05120000000;      // 2.0 sqrt argument

    // Print first 800 digits of Pi; adapted from C program by Dik Winter of CWI, Amsterdam
    this.MM[ 300]= 0x00000100371; //       CAD   FLIM
    this.MM[ 301]= 0x00000400365; //       STA   C               C=FLIM
    this.MM[ 302]= 0x00000100363; //       CAD   A
    this.MM[ 303]= 0x00001480010; //       SRT   10
    this.MM[ 304]= 0x00000150375; //       DIV   FIVE            A DIV 5
    this.MM[ 305]= 0x00000420365; //       LDB   C               FOR (B=C; B>=0; --B)
    this.MM[ 306]= 0x10000401000; //       STA - F               F[B]=A DIV 5
    this.MM[ 307]= 0x00001210306; //       DBB   *-1,1

    this.MM[ 308]= 0x00000100365; // L1    CAD   C               START OF OUTER LOOP
    this.MM[ 309]= 0x00000140374; //       MUL   TWO
    this.MM[ 310]= 0x00001400368; //       STR   G               G=C*2
    this.MM[ 311]= 0x00000370362; //       BFR   ENDL1,00,00     IF G EQL 0, BRANCH OUT OF LOOP
    this.MM[ 312]= 0x00000460366; //       CLL   D               D=0
    this.MM[ 313]= 0x00000100365; //       CAD   C
    this.MM[ 314]= 0x00000400364; //       STA   B               B=C
    this.MM[ 315]= 0x00000420364; //       LDB   B

    this.MM[ 316]= 0x10000101000; // DO    CAD - F               START OF INNER LOOP
    this.MM[ 317]= 0x00000140363; //       MUL   A               F[B]*A
    this.MM[ 318]= 0x00001490010; //       SLT   10              SHIFT PRODUCT TO RA
    this.MM[ 319]= 0x00000120366; //       ADD   D
    this.MM[ 320]= 0x00000400366; //       STA   D               D+=F[B]*A
    this.MM[ 321]= 0x00001480010; //       SRT   10              SAVE NEW D IN RR
    this.MM[ 322]= 0x00001270368; //       DFL   G,00,1          G-=1
    this.MM[ 323]= 0x00000150368; //       DIV   G               D DIV G
    this.MM[ 324]= 0x10001401000; //       STR - F               F[B]=D MOD G
    this.MM[ 325]= 0x00000400366; //       STA   D               D=D DIV G
    this.MM[ 326]= 0x00001270368; //       DFL   G,00,1          G-=1
    this.MM[ 327]= 0x00000100364; //       CAD   B
    this.MM[ 328]= 0x00000130373; //       SUB   ONE
    this.MM[ 329]= 0x00000400364; //       STA   B               B-=1
    this.MM[ 330]= 0x00000360334; //       BFA   ENDDO,00,00     IF B EQL 0, BRANCH OUT OF INNER LOOP
    this.MM[ 331]= 0x00000140366; //       MUL   D
    this.MM[ 332]= 0x00001400366; //       STR   D               D*=B
    this.MM[ 333]= 0x00001210316; //       DBB   DO,1            DECREMENT RB, REPEAT INNER LOOP IF >= 0

    this.MM[ 334]= 0x00014270365; // ENDDO DFL   C,00,14         C-=14
    this.MM[ 335]= 0x00000100366; //       CAD   D
    this.MM[ 336]= 0x00001480010; //       SRT   10
    this.MM[ 337]= 0x00000150363; //       DIV   A               D DIV A
    this.MM[ 338]= 0x00000120367; //       ADD   E               RA=E+D DIV A
    this.MM[ 339]= 0x00001400367; //       STR   E               E=D MOD A

                                  //                             FORMAT 4 DIGITS FOR SPO OUTPUT
    this.MM[ 340]= 0x00001480003; //       SRT   3               ISOLATE HIGH-ORDER DIGIT IN A
    this.MM[ 341]= 0x00000120376; //       ADD   N80             CONVERT 1ST DIGIT TO ALPHA
    this.MM[ 342]= 0x00000490001; //       SLA   1
    this.MM[ 343]= 0x00001490001; //       SLT   1
    this.MM[ 344]= 0x00000120376; //       ADD   N80             CONVERT 2ND DIGIT TO ALPHA
    this.MM[ 345]= 0x00000490001; //       SLA   1
    this.MM[ 346]= 0x00001490001; //       SLT   1
    this.MM[ 347]= 0x00000120376; //       ADD   N80             CONVERT 3RD DIGIT TO ALPHA
    this.MM[ 348]= 0x00000490001; //       SLA   1
    this.MM[ 349]= 0x00001490001; //       SLT   1
    this.MM[ 350]= 0x00000120376; //       ADD   N80             CONVERT 4TH DIGIT TO ALPHA
    this.MM[ 351]= 0x00000490002; //       SLA   2               INSERT TRAILING SPACE
    this.MM[ 352]= 0x00002430000; //       LSA   2               SET SIGN TO TWO FOR ALPHA WORD
    this.MM[ 353]= 0x00000400364; //       STA   B               STORE IN WORD BUFFER
    this.MM[ 354]= 0x00010090364; //       SPO   B,1
    this.MM[ 355]= 0x00405260369; //       IFL   COL,04,1        CHECK FOR FULL LINE ON SPO
    this.MM[ 356]= 0x00000100369; //       CAD   COL
    this.MM[ 357]= 0x00000180370; //       CFA   ECOL
    this.MM[ 358]= 0x00001340308; //       BCL   L1              IF COL < ECOL, BRANCH
    this.MM[ 359]= 0x00010090377; //       SPO   CR,1            OUTPUT NEWLINES
    this.MM[ 360]= 0x00000460369; //       CLL   COL             CLEAR COLUMN COUNTER
    this.MM[ 361]= 0x00000300308; //       BUN   L1
    this.MM[ 362]= 0x00000007557; // ENDL1 HLT   7557

    this.MM[ 363]= 0x00000010000; // A     CNST  10000
    this.MM[ 364]= 0x00000000000; // B     CNST  0
    this.MM[ 365]= 0x00000000000; // C     CNST  0
    this.MM[ 366]= 0x00000000000; // D     CNST  0
    this.MM[ 367]= 0x00000000000; // E     CNST  0
    this.MM[ 368]= 0x00000000000; // G     CNST  0
    this.MM[ 369]= 0x00000000000; // COL   CNST  0
    this.MM[ 370]= 0x00000000050; // ECOL  CNST  50
    this.MM[ 371]= 0x00000002800; // FLIM  CNST  2800
    this.MM[ 372]= 0x00000000000; // ZERO  CNST  0
    this.MM[ 373]= 0x00000000001; // ONE   CNST  1
    this.MM[ 374]= 0x00000000002; // TWO   CNST  2
    this.MM[ 375]= 0x00000000005; // FIVE  CNST  5
    this.MM[ 376]= 0x00000000080; // N80   CNST  80
    this.MM[ 377]= 0x20202021616; // CR    CNST  20202021616     NEWLINES

    this.MM[1000]= 0x00000000000; // F     DEFN  *               ARRAY F[2800]
};