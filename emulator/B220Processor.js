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
    this.MM = new Float64Array(this.memorySize);        // main memory, 11-digit words
    this.IB = new B220Processor.Register(11*4, this, true);     // memory Input Buffer

    // Processor throttling control and timing statistics
    this.execTime = 0;                  // estimated instruction executime time, ms
    this.execLimit = 0;                 // current time slice limit on this.execTime
    this.procStart = 0;                 // Javascript time that the processor started running, ms
    this.procTime = 0;                  // total internal running time for processor, ms
    this.scheduler = 0;                 // current setCallback token
    this.runTimer = 0;                  // elapsed run-time timer value, ms

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

    // Control Console Lamps
    this.digitCheckAlarm =      new B220Processor.FlipFlop(this, false);
    this.programCheckAlarm =    new B220Processor.FlipFlop(this, false);
    this.storageAlarm =         new B220Processor.FlipFlop(this, false);
    this.magneticTapeAlarm =    new B220Processor.FlipFlop(this, false);
    this.paperTapeAlarm =       new B220Processor.FlipFlop(this, false);
    this.cardatronAlarm =       new B220Processor.FlipFlop(this, false);
    this.highSpeedPrinterAlarm =new B220Processor.FlipFlop(this, false);

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
    this.AX = new B220Processor.Register(10, this, false);      // AX register
    this.BI = new B220Processor.Register( 8, this, false);      // paper tape decoder
    this.DX = new B220Processor.Register( 8, this, false);      // DX register
    this.PA = new B220Processor.Register( 8, this, false);      // PA register

    this.ALT = new B220Processor.FlipFlop(this, false);         // program check alarm toggle
    this.AST = new B220Processor.FlipFlop(this, false);         // asynchronous toggle
    this.CCT = new B220Processor.FlipFlop(this, false);         // ?? toggle
    this.CRT = new B220Processor.FlipFlop(this, false);         // Cardatron alarm toggle
    this.DPT = new B220Processor.FlipFlop(this, false);         // ?? digit pulse toggle
    this.EWT = new B220Processor.FlipFlop(this, false);         // end of word toggle
    this.EXT = new B220Processor.FlipFlop(this, false);         // fetch(0)/execute(1) toggle
    this.HAT = new B220Processor.FlipFlop(this, false);         // ?? toggle
    this.HCT = new B220Processor.FlipFlop(this, false);         // halt control toggle, for SOR, SOH, IOM (I think)
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

    // Mag-Tape Control Unit switch
    this.tswSuppressB = 0;              // Suppress B-register modification on input

    // Context-bound routines
    this.boundUpdateLampGlow = B220Processor.bindMethod(this, B220Processor.prototype.updateLampGlow);

    this.boundConsoleOutputSignDigit = B220Processor.bindMethod(this, B220Processor.prototype.consoleOutputSignDigit);
    this.boundConsoleOutputNumberDigit= B220Processor.bindMethod(this, B220Processor.prototype.consoleOutputNumberDigit);
    this.boundConsoleOutputFinished = B220Processor.bindMethod(this, B220Processor.prototype.consoleOutputFinished);
    this.boundConsoleInputDigit = B220Processor.bindMethod(this, B220Processor.prototype.consoleInputDigit);
    this.boundConsoleReceiveDigit = B220Processor.bindMethod(this, B220Processor.prototype.consoleReceiveDigit);
    this.boundConsoleReceiveSingleDigit = B220Processor.bindMethod(this, B220Processor.prototype.consoleReceiveSingleDigit);

    this.boundCardatronOutputWordReady = B220Processor.bindMethod(this, B220Processor.prototype.cardatronOutputWordReady);
    this.boundCardatronOutputWord= B220Processor.bindMethod(this, B220Processor.prototype.cardatronOutputWord);
    this.boundCardatronOutputFinished = B220Processor.bindMethod(this, B220Processor.prototype.cardatronOutputFinished);
    this.boundCardatronInputWord = B220Processor.bindMethod(this, B220Processor.prototype.cardatronInputWord);
    this.boundCardatronReceiveWord = B220Processor.bindMethod(this, B220Processor.prototype.cardatronReceiveWord);

    this.boundMagTapeReceiveBlock = B220Processor.bindMethod(this, B220Processor.prototype.magTapeReceiveBlock);
    this.boundMagTapeInitiateSend = B220Processor.bindMethod(this, B220Processor.prototype.magTapeInitiateSend);
    this.boundMagTapeSendBlock = B220Processor.bindMethod(this, B220Processor.prototype.magTapeSendBlock);
    this.boundMagTapeTerminateSend = B220Processor.bindMethod(this, B220Processor.prototype.magTapeTerminateSend);

    this.clear();                       // Create and initialize the processor state

    this.loadDefaultProgram();          // Preload a default program
}


/***********************************************************************
*   Global Constants                                                   *
***********************************************************************/

B220Processor.version = "0.00b";

B220Processor.tick = 1000/200000;       // milliseconds per clock cycle (200KHz)
B220Processor.cyclesPerMilli = 1/B220Processor.tick;
                                        // clock cycles per millisecond (200 => 200KHz)
B220Processor.timeSlice = 10;           // maximum processor time slice, ms
B220Processor.delayAlpha = 0.001;       // decay factor for exponential weighted average delay
B220Processor.delayAlpha1 = 1-B220Processor.delayAlpha;
B220Processor.slackAlpha = 0.0001;      // decay factor for exponential weighted average slack
B220Processor.slackAlpha1 = 1-B220Processor.slackAlpha;

B220Processor.neonPersistence = 1000/30;
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

B220Processor.operandRequired = [       // true if op code requires a memory operand
    //  0   1   2   3   4   5   6   7   8   9   A   B   C   D   E   F
        0,  0,  0,  1,  1,  1,  0,  0,  0,  1,  0,  0,  0,  0,  0,  0,  // 00-0F
        1,  1,  1,  1,  1,  1,  0,  1,  1,  1,  0,  0,  0,  0,  0,  0,  // 01-1F
        0,  0,  1,  1,  1,  1,  1,  1,  1,  1,  0,  0,  0,  0,  0,  0,  // 02-2F
        0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  // 03-3F
        0,  1,  1,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  // 04-4F
        0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  // 05-5F
        0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  // 06-6F
        0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  // 07-7F
        0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  // 08-8F
        0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0]; // 09-9F


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
*   System Clear                                                       *
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
    this.programCheckAlarm.set(0);
    this.storageAlarm.set(0);
    this.magneticTapeAlarm.set(0);
    this.paperTapeAlarm.set(0);
    this.cardatronAlarm.set(0);

    this.systemNotReady.set(0);
    this.computerNotReady.set(0);

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

    // Kill any pending action that may be in process
    if (this.scheduler) {
        clearCallback(this.scheduler);
        this.scheduler = 0;
    }

    // Clear Cardatron Control Unit
    if (this.cardatron) {
        this.cardatron.clear();
    }
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
    Note that it is important to increment this.execTime in the caller AFTER
    setting new values in registers and flip-flops. This allows the average
    intensity to be computed based on the amount of time a bit was actually in
    that state */

    this.bits = bits;                   // number of bits in register
    this.visible = (invisible ? false : true);
    this.lastExecTime = 0;              // time register was last set
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

    if (    (((v1 & 0x8888888) >>> 3) & (((v1 & 0x4444444) >>> 2) | ((v1 & 0x2222222) >>> 1))) |
            (((v2 & 0x8888888) >>> 3) & (((v2 & 0x4444444) >>> 2) | ((v2 & 0x2222222) >>> 1)))    ) {
        this.p.setDigitCheck(1);
        return 1;
    } else {
        return 0;
    }
};

/**************************************/
B220Processor.Register.prototype.updateGlow = function updateGlow() {
    /* Updates the lamp glow averages based on this.p.execTime. Note that the
    glow is always aged by at least one clock tick */
    var alpha = Math.max(Math.max(this.p.execTime-this.lastExecTime, B220Processor.tick)/
                         B220Processor.maxGlowTime, 1.0);
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

    this.lastExecTime = this.p.execTime;
};

/**************************************/
B220Processor.Register.prototype.set = function set(value) {
    /* Set a binary value into the register. Use this rather than setting
    the value member directly so that average lamp glow can be computed.
    Returns the new value */

    this.value = value;
    if (this.visible) {
       this.updateGlow();
    }

    this.checkFC();
    return value;
};

/**************************************/
B220Processor.Register.prototype.getDigit = function getDigit(digitNr) {
    /* Returns the value of a 4-bit digit in the register. Digits are numbered
    from 0 starting at the low end (not the way the 220 numbers them) */

    return B220Processor.fieldIsolate(this.value, digitNr*4-1, 4);
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
    var alpha = Math.max(Math.max(this.p.execTime-this.lastExecTime, B220Processor.tick)/
                         B220Processor.maxGlowTime, 1.0);
    var bit = value%2;

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
    var alpha = Math.max(Math.max(this.p.execTime-this.lastExecTime, B220Processor.tick)/
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
    Returns the new register value. NOTE THAT THE ADDEND IS IN BCD, NOT BINARY */

    return this.set(this.p.bcdAdd(this.value, addend) % B220Processor.pow2[this.bits]);
};


/***********************************************************************
*   Generic Flip-Flop Class                                            *
***********************************************************************/

B220Processor.FlipFlop = function FlopFlop(p, invisible) {
    /* Constructor for the generaic FlipFlop class. "p" is a reference to the
    Processor object, used to access the timing members. "invisible" should be
    true if the FF does not have a visible presence in the UI -- this will
    inhibit computing the average lamp glow value for it.
    Note that it is important to increment this.execTime in the caller AFTER
    setting new values in registers and flip-flops. This allows the average
    intensity to be computed based on the amount of time a bit was actually in
    that state */

    this.visible = (invisible ? false : true);
    this.lastExecTime = 0;              // time register was last set
    this.p = p;                         // processor instance
    this.value = 0;                     // binary value of register: read-only externally
    this.glow = 0;                      // average lamp glow value
};

/**************************************/
B220Processor.FlipFlop.prototype.updateGlow = function updateGlow() {
    /* Updates the average glow for the flip flop. Note that the glow is
    always aged by at least one clock tick. Returns the new average */
    var alpha = Math.max(Math.max(this.p.execTime-this.lastExecTime, B220Processor.tick)/
                         B220Processor.maxGlowTime, 1.0);
    var v = (this.value ? 1 : 0);

    if (this.visible) {
        this.glow = this.glow*(1.0-alpha) + v*alpha;
    }

    this.lastExecTime = this.p.execTime;
    return this.glow;
};

/**************************************/
B220Processor.FlipFlop.prototype.set = function set(value) {
    /* Set the value of the FF. Use this rather than setting the value member
    directly so that average lamp glow can be computed. Returns the new value */

    this.value = value;
    if (this.visible) {
        this.updateGlow();
    }

    return value;
};

/**************************************/
B220Processor.FlipFlop.prototype.flip = function flip() {
    /* Complement the value of the FF. Returns the new value */

    return this.set(this.value ? 0 : 1);
};


/***********************************************************************
* Timing and Statistics Functions                                      *
***********************************************************************/

// TBD


/***********************************************************************
*   System Alarms                                                      *
***********************************************************************/

/**************************************/
B220Processor.prototype.setDigitCheck = function setDigitCheck(value) {
    /* Sets the Digit Check alarm */

    if (!this.ALARMSW && !this.DIGITCHECKSW) {
        this.digitCheckAlarm.set(value);
        if (value) {
            this.RUT.set(0);
        }
    }
};

/**************************************/
B220Processor.prototype.setProgramCheck = function setProgramCheck(value) {
    /* Sets the Program Check alarm */

    if (!this.ALARMSW) {
        this.programCheckAlarm.set(value);
        this.ALT.set(value);
        if (value) {
            this.RUT.set(0);
        }
    }
};

/**************************************/
B220Processor.prototype.setStorageCheck = function setStorageCheck(value) {
    /* Sets the Storage Check alarm */

    if (!this.ALARMSW) {
        this.storageCheckAlarm.set(value);
        this.MET.set(value);
        if (value) {
            this.RUT.set(0);
        }
    }
};

/**************************************/
B220Processor.prototype.setMagneticTapeCheck = function setMagneticTapeCheck(value) {
    /* Sets the Magnetic Tape Check alarm */

    if (!this.ALARMSW) {
        this.magneticTapeAlarm.set(value);
        this.TAT.set(value);
        if (value) {
            this.RUT.set(0);
        }
    }
};

/**************************************/
B220Processor.prototype.setCardatronCheck = function setCardatronCheck(value) {
    /* Sets the Cardatron Check alarm */

    if (!this.ALARMSW) {
        this.cardatronAlarm.set(value);
        this.CRT.set(value);
        if (value) {
            this.RUT.set(0);
        }
    }
};

/**************************************/
B220Processor.prototype.setPaperTapeCheck = function setPaperTapeCheck(value) {
    /* Sets the Paper Tape Check alarm */

    if (!this.ALARMSW) {
        this.paperTapeAlarm.set(value);
        this.PAT.set(value);
        if (value) {
            this.RUT.set(0);
        }
    }
};

/**************************************/
B220Processor.prototype.setHighSpeedPrinterCheck = function setHighSpeedPrinterCheck(value) {
    /* Sets the Cardatron Check alarm */

    if (!this.ALARMSW) {
        this.highSpeedPrinterAlarm.set(value);
        this.CRT.set(value);
        if (value) {
            this.RUT.set(0);
        }
    }
};


/***********************************************************************
*   The 220 Adder and Arithmetic Operations                            *
***********************************************************************/

/**************************************/
B220Processor.prototype.bcdAdd = function bcdAdd(a, d, complement, initialCarry) {
    /* Performs an unsigned, BCD addition of "a" and "d", producing an 11-digit
    BCD result. On input, "complement" indicates whether 9s-complement addition
    should be performed; "initialCarry" indicates whether an initial carry of 1
    should be applied to the adder. On output, this.CI is set from the final
    carry toggles of the addition. Further, this.Z will still have a copy of the
    sign (11th) digit. Sets the Program Check alarm if non-decimal digits are
    encountered, but does not set the Overflow toggle */
    var ad;                             // current augend (a) digit;
    var adder;                          // local copy of adder digit
    var am = a % 0x100000000000;        // augend mantissa
    var carry = (initialCarry || 0) & 1;// local copy of carry toggle (CI1, CAT)
    var compl = complement || 0;        // local copy of complement toggle
    var ct = carry;                     // local copy of carry register (CI1-16)
    var dd;                             // current addend (d) digit;
    var dm = d % 0x100000000000;        // addend mantissa
    var x;                              // digit counter

    this.DC.set(0x09);                  // 20-11: for display only

    // Loop through the 11 digits including sign digits
    for (x=0; x<11; ++x) {
        // shift low-order augend digit right into the adder
        ad = am % 0x10;
        am = (am - ad)/0x10;
        if (ad > 9) {
            this.setDigitCheck(1);
        } else if (compl) {
            ad = 9-ad;
        }

        // Add the digits plus carry, complementing as necessary
        dd = dm % 0x10;
        if (dd > 9) {
            this.setDigitCheck(1);
        }

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
        this.X.set(ad);
        this.Y.set(dd);
        this.Z.set(adder);
        this.C10.set(carry);
        this.CI.set(ct);
        this.SI.set(0x0F - ct);         // just a guess as to the sum inverters

        // rotate the adder into the sign digit
        am += adder*0x10000000000;
        // shift the addend right to the next digit
        dm = (dm - dd)/0x10;
    } // for x

    // Set toggles for display purposes and return the result
    return am;
};

/**************************************/
B220Processor.prototype.integerAdd = function integerAdd() {
    /* Algebraically add the addend (IB) to the augend (A), returning the result
    in A and storing IB in D. All values are BCD with the sign in the 11th digit
    position. Sets the Overflow and Program Check alarms as necessary */
    var am = this.A.value % 0x10000000000;      // augend mantissa
    var aSign = ((this.A.value - am)/0x10000000000);
    var compl;                                  // complement addition required
    var dm = this.IB.value % 0x10000000000;      // addend mantissa
    var dSign = (this.IB.value - dm)/0x10000000000;
    var sign = dSign & 0x01;                    // local copy of sign toggle
    var timing = 0.185;

    compl = (aSign^dSign) & 0x01;
    am = this.bcdAdd(am, dm, compl, compl);

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
        am = this.bcdAdd(am, 0, 1, 1);
        // after recomplementing, set the correct sign (adder still contains sign of result)
        am += (sign - this.Z.value)*0x10000000000;
        timing += 0.060;
        break;
    } // switch this.Z.value

    if (am%0x10000000000 == 0) {
        am = (aSign%2)*0x10000000000;
    }

    // Set toggles for display purposes and return the result
    this.DST.set(dSign);
    this.SGT.set(sign);
    this.D.set(dSign*0x10000000000 + dm);
    this.A.set(am);
    this.execTime += timing;
};

/**************************************/
B220Processor.prototype.integerExtract = function integerExtract() {
    /* "Extract" digits from A according to the digit pattern in D.
    This is actually a weird form of add. In the simple case, the extract
    pattern  consists of a string of ones and zeroes. The value digits will be
    retained where the corresponding pattern digits are 1 and will be zeroed
    where the corresponding pattern digits are zero.
    In the general case, if the pattern digit is even, that digit replaces the
    corresponding digit in the value. If the pattern digit is odd, then that
    digit minus one is added to the corresponding value digit. In this latter
    case, carries from digit to digit occur normally, and thus a generalized
    extract can result in overflow.
    Sets the Overflow and Forbidden-Combination stops as necessary */
    var ad;                             // current value (A) digit;
    var adder = 0;                      // local copy of adder digit
    var am = this.A.value % 0x10000000000;    // value mantissa
    var aSign = ((this.A.value - am)/0x10000000000) & 0x01;
    var carry;                          // local copy of carry toggle (CT 1)
    var ct;                             // local copy of carry register (CT 1-16)
    var dd;                             // current pattern (D) digit;
    var dm = this.D.value;                    // pattern mantissa
    var dSign = ((this.D.value - this.D.value%0x10000000000)/0x10000000000);
    var sign = aSign & dSign & 0x01;    // local copy of sign toggle
    var x;                              // digit counter

    this.togCLEAR = 1;                  // for display only
    this.togADDER = 1;                  // for display only
    this.togDPCTR = 1;                  // for display only
    ct = carry = 0;

    // Loop through the 11 digits including signs (which were set to zero in am and dm)
    for (x=0; x<11; ++x) {
        // shift low-order value digit right into the adder
        ad = am % 0x10;
        am = (am - ad)/0x10;
        if (ad > 9) {
            this.stopForbidden = 1;
            this.togCST = 1;            // halt the processor
        }

        // add the digits plus carry, complementing as necessary
        dd = dm % 0x10;
        // shift the pattern right to the next digit
        dm = (dm - dd)/0x10;
        if (dd > 9) {
            this.stopForbidden = 1;
            this.togCST = 1;            // halt the processor
        }
        if (dd & 0x01) {                // if extract digit is odd
            dd &= 0x0E;                 // force extract digit to even (so adder=ad+dd-1)
        } else {                        // otherwise, if it's even
            ad = 0;                     // clear A digit so D digit will replace it (adder=dd)
        }
        adder = ad + dd + carry;

        // decimal-correct the adder
        if (adder < 10) {
            carry = 0;
        } else {
            adder -= 10;
            carry = 1;
        }

        // compute the carry toggle register (just for display)
        ct = (((ad & dd) | (ad & ct) | (dd & ct)) << 1) + carry;
        // rotate the adder into the sign digit
        am += adder*0x10000000000;
    } // for x

    // Now examine the resulting sign (still in the adder) to see if we have overflow
    if (adder == 0) {
        am += sign*0x10000000000;
    } else if (adder == 1) {
        am += (sign-1)*0x10000000000;
        this.OFT.set(1);
    }

    // Set toggles for display purposes and return the result
    this.togCOMPL = 0;
    this.togSIGN = sign;
    this.C.valueT = ct;
    this.A.valueDDER = adder;
    this.A.set(am);
    this.D.set(0);
};

/**************************************/
B220Processor.prototype.integerMultiply = function integerMultiply(roundOff) {
    /* Algebraically multiply the D register by the A register, producing a
    20-digit product in A and R. All values are BCD with the sign in the 11th digit
    position. If roundOff is truthy, the product in the A register is rounded and
    the R register is cleared. Sets Forbidden-Combination stop as necessary.
    Overflow is not possible */
    var ad;                             // current product (A) digit;
    var am = this.A.value % 0x10000000000;    // product (A) mantissa
    var aSign = ((this.A.value - am)/0x10000000000) & 0x01;
    var count = 0;                      // count of word-times consumed
    var dm = this.D.value % 0x10000000000;    // multiplicand mantissa
    var dSign = ((this.D.value - dm)/0x10000000000) & 0x01;
    var rc;                             // dup of rd for add counting
    var rd;                             // current multipler (R) digit;
    var rm = am;                        // current multiplier (R) mantissa
    var sign = aSign ^ dSign;           // local copy of sign toggle (sign of product)
    var x;                              // digit counter

    this.togMULDIV = 1;                 // for display only
    this.SHIFT = 0x09;                  // for display only
    this.SHIFTCONTROL = 0x0C;           // for display only
    am = 0;                             // clear the local product (A) mantissa

    // We now have the multiplicand in D (dm), the multiplier in R (rm), and an
    // initial product of zero in A (am). Go through a classic multiply cycle,
    // doing repeated addition based on each multipler digit, and between digits
    // shifting the product (in am and rm) one place to the right. After 10 digits,
    // we're done.

    this.togCOMPL = 0;
    for (x=0; x<10; ++x) {
        rc = rd = rm % 0x10;
        count += rc;
        while (rc > 0) {
            am = this.bcdAdd(am, dm, 0, 0);
            --rc;
        } // while rd

        ad = am % 0x10;
        am = (am-ad)/0x10;
        rm = (rm-rd)/0x10 + ad*0x1000000000;
    } // for x

    if (roundOff) {
        ++count;
        if (rm >= 0x5000000000) {
            am = this.bcdAdd(am, 0x01, 0, 0);
        }
        this.R.set(0);
        this.D.set(0);
    }

    this.execTime += 13 + count*2;
    this.SPECIAL = 0x09;                // for display only
    this.togSIGN = sign;                // for display only
    this.A.set(sign*0x10000000000 + am);
    this.R.set(rm);
    this.D.set(0);
};

/**************************************/
B220Processor.prototype.integerDivide = function integerDivide() {
    /* Algebraically divide the A & R registers by the D register, producing a
    signed 10-digit quotient in A and the remainder in R. All values are BCD
    with the sign in the 11th digit position. Sets Forbidden-Combination stop
    as necessary. If the magnitude of the divisor (D) is less or equal to the
    magnitude of the dividend (A), the Overflow stop it set and division
    terminates, unconditionally setting A & R to zero */
    var am = this.A.value % 0x10000000000;    // current remainder (A) mantissa
    var aSign = ((this.A.value - am)/0x10000000000) & 0x01;
    var count = 0;                      // count of word-times consumed
    var dm = this.D.value % 0x10000000000;    // divisor mantissa
    var dSign = ((this.D.value - dm)/0x10000000000) & 0x01;
    var rd;                             // current quotient (R) digit;
    var rm = this.R.value;                    // current quotient (R) mantissa
    var sign = aSign ^ dSign;           // local copy of sign toggle (sign of quotient)
    var x;                              // digit counter

    this.togMULDIV = 1;                 // for display only
    this.togDELTABDIV = 1;              // for display only
    this.togDIVALARM = 1;               // for display only
    this.SPECIAL = 0x09;                // for display only: state at end unless overflow is set

    // We now have the divisor in D (dm) and the dividend in A (am) & R (rm).
    // The value in am will become the remainder; the value in rm will become
    // the quotient. Go through a classic long-division cycle, repeatedly
    // subtracting the divisor from the dividend, counting subtractions until
    // underflow occurs, and shifting the divisor left one digit.

    for (x=0; x<10; ++x) {
        // First, shift A & R to the left one digit, with A1 shifting to ASGN
        rd = (rm - rm%0x1000000000)/0x1000000000;
        rm = (rm%0x1000000000)*0x10;
        am = am*0x10 + rd;

        // Now repeatedly subtract D from A until we would get underflow.
        // Unlike the 220, we don't do one subtraction too many.
        rd = 0;
        while (am >= dm && rd < 10) {
            am = this.bcdAdd(dm, am, 1, 1);
            ++rd;
            ++count;
        }

        // Check for overflow (dividend > divisor).
        if (rd < 10) {
            rm += rd;                   // accumulate the quotient digit
            this.togDIVALARM = 0;
        } else {
            this.OFT.set(1);
            this.SPECIAL = 0x0F;        // for display only
            am = rm = 0;
            break;                      // out of for loop
        }
    } // for x

    this.SHIFTCONTROL = 0x0E;           // for display only
    this.SHIFT = 0x09;                  // for display only
    this.togSIGN = sign;                // for display only
    this.togSTEP = 1;                   // for display only
    this.A.set(sign*0x10000000000 + rm);
    this.R.set(am);
    this.D.set(0);
    if (this.stopOverflow) {
        this.execTime += 24;
    } else {
        this.execTime += 52 + count*2;
    }
};

/**************************************/
B220Processor.prototype.floatingAdd = function floatingAdd() {
    /* Algebraically add the floating-point addend (D) to the floating-point
    augend (A), placing the result in A and clearing D. The R register is not
    affected. All values are BCD with the sign in the 11th digit position.
    The floating exponent is in the first two digit positions, biased by 50.
    Sets the Overflow and Forbidden-Combination stops as necessary */
    var ae;                             // augend exponent (binary)
    var am = this.A.value % 0x10000000000;    // augend mantissa (BCD)
    var aSign = ((this.A.value - am)/0x10000000000) & 0x01;
    var compl;                          // complement addition required
    var d;                              // scratch digit;
    var de;                             // addend exponent (binary)
    var dm = this.D.value % 0x10000000000;    // addend mantissa (BCD)
    var dSign = ((this.D.value - dm)/0x10000000000) & 0x01;
    var sign = dSign;                   // local copy of sign toggle

    this.togADDER = 1;                  // for display only
    this.togDPCTR = 1;                  // for display only

    ae = (am - am%0x100000000)/0x100000000;
    am %= 0x100000000;
    de = (dm - dm%0x100000000)/0x100000000;
    dm %= 0x100000000;

    // If the exponents are unequal, normalize the larger and scale the smaller
    // until they are in alignment, or one mantissa becomes zero.
    if (am == 0) {
        ae = de;
    } else if (dm == 0) {
        de = ae;
    } else if (ae > de) {
        // Normalize A
        while (ae > de && am < 0x10000000) {
            am *= 0x10;                 // shift left
            ae = this.bcdAdd(1, ae, 1, 1);      // --ae
        }
        // Scale D until its exponent matches or the mantissa goes to zero.
        while (ae > de && dm > 0) {
            d = dm % 0x10;
            dm = (dm - d)/0x10;         // shift right
            de = this.bcdAdd(1, de, 0, 0);      // ++de
        }
    } else if (ae < de) {
        // Normalize D
        while (ae < de && dm < 0x10000000) {
            dm *= 0x10;                 // shift left
            de = this.bcdAdd(1, de, 1, 1);      // --de
        }
        // Scale A until its exponent matches or the mantissa goes to zero.
        while (ae < de && am > 0) {
            d = am % 0x10;
            am = (am - d)/0x10;         // shift right
            ae = this.bcdAdd(1, ae, 0, 0);      // ++ae
        }
    }

    compl = (aSign^dSign);
    am = this.bcdAdd(am, dm, compl, compl);

    // Now examine the resulting sign (still in the adder) to see if we
    // need to recomplement the result.
    if (this.ADDER) {
        // Reverse the sign toggle and recomplement the result (virtually adding to the zeroed dm).
        sign = 1-sign;
        am = this.bcdAdd(am, 0, 1, 1);
        this.execTime += 2;
    }

    // Normalize or scale the result as necessary
    this.SPECIAL = 0;                   // for display only
    if (am >= 0x100000000) {
        // Mantissa overflow: add/subtract can produce at most one digit of
        // overflow, so shift right and increment the exponent, checking for
        // overflow in the exponent.
        if (ae < 0x99) {
            ++this.SPECIAL;             // for display only
            d = am % 0x10;
            am = (am - d)/0x10;         // shift right
            ae = this.bcdAdd(1, ae, 0, 0);      // ++ae
        } else {
            // A scaling shift would overflow the exponent, so set the overflow
            // alarm and leave the mantissa as it was from the add, without the
            // exponent inserted back into it. Since the A register gets reassembled
            // below, we need to set up the mantissa and exponent so the reconstruct
            // will effectively do nothing.
            this.OFT.set(1);
            sign = 0;                   // per 220 FP Handbook
            ae = (am - am%0x100000000)/0x100000000;
            am %= 0x100000000;
        }
    } else if (am > 0) {
        // Normalize the result as necessary
        while (am < 0x10000000) {
            if (ae > 0) {
                ++this.SPECIAL;         // for display only
                am *= 0x10;             // shift left
                ae = this.bcdAdd(1, ae, 1, 1);  // --ae
            } else {
                // Exponent underflow: set R and the reconstructed A to zero.
                am = ae = sign = 0;
                this.R.set(0);
                break;
            }
        }
    } else {                            // mantissa is zero
        ae = 0;                         // per example in 220 FP Handbook
    }

    // Set toggles for display purposes and set the result.
    this.togSIGN = sign;
    this.A.set((sign*0x100 + ae)*0x100000000 + am);
    this.D.set(0);
};

/**************************************/
B220Processor.prototype.floatingMultiply = function floatingMultiply() {
    /* Algebraically multiply the floating-point multiplicand in the D register
    by the floating-point multiplier in the A register, producing an 18-digit
    product (16 mantissa + 2 exponent) in A and R. All values are BCD with the
    sign in the 11th digit position. The floating exponent is in the first two
    digit positions, biased by 50. Sets the Forbidden-Combination stop as
    necessary */
    var ad;                             // current product (A) digit;
    var ae;                             // product/multiplier (A) exponent
    var am = this.A.value % 0x10000000000;    // product (A) mantissa
    var aSign = ((this.A.value - am)/0x10000000000) & 0x01;
    var count = 0;                      // count of word-times consumed
    var de;                             // multiplicand exponent
    var dm = this.D.value % 0x10000000000;    // multiplicand mantissa
    var dSign = ((this.D.value - dm)/0x10000000000) & 0x01;
    var rc;                             // dup of rd for add counting
    var rd;                             // current multipler (R) digit;
    var rm;                             // current multiplier (R) mantissa
    var sign = aSign ^ dSign;           // local copy of sign toggle (sign of product)
    var x;                              // digit counter

    this.togMULDIV = 1;                 // for display only
    this.SPECIAL = 0;                   // for display only
    ae = (am - am%0x100000000)/0x100000000;
    am %= 0x100000000;
    de = (dm - dm%0x100000000)/0x100000000;
    dm %= 0x100000000;

    if (am == 0) {
        this.A.set(0);
        this.R.set(0);
    } else if (dm == 0) {
        this.A.set(0);
        this.R.set(0);
   } else {
        ae = this.bcdAdd(ae, de);
        if (ae >= 0x150) {
            this.OFT.set(1);
            sign = 0;
            this.A.set(am);
            this.R.set(0);
        } else {
            rm = am;                            // move the multiplier to R
            am = 0;                             // clear the local product (A) mantissa
            this.SHIFT = 0x09;                  // for display only
            this.SHIFTCONTROL = 0x0C;           // for display only

            // We now have the multiplicand in D (dm), the multiplier in R (rm), and an
            // initial product of zero in A (am). Go through a classic multiply cycle,
            // doing repeated addition based on each multipler digit, and between digits
            // shifting the product (in am and rm) one place to the right. After 8 digits,
            // we're done, except for normalization.

            this.togCOMPL = 0;
            for (x=0; x<8; ++x) {
                rc = rd = rm % 0x10;
                count += rc;
                while (rc > 0) {
                    am = this.bcdAdd(am, dm, 0, 0);
                    --rc;
                } // while rd

                ad = am % 0x10;
                am = (am-ad)/0x10;
                rm = (rm-rd)/0x10 + ad*0x1000000000;
            } // for x

            // Check for exponent underflow
            if (ae < 0x50) {
                this.A.set(0);
                this.R.set(0);          // underflow
            } else {
                // Subtract the exponent bias and normalize the result as necessary.
                ae = this.bcdAdd(0x50, ae, 1, 1);
                while (am < 0x10000000) {
                    if (ae <= 0) {
                        // Exponent underflow: set R and the reconstructed A to zero.
                        am = ae = sign = 0;
                        this.R.set(0);
                        break;
                    } else {
                        ++this.SPECIAL;         // for display only
                        rd = (rm - rm%0x1000000000)/0x1000000000;
                        rm = (rm % 0x1000000000)*0x10;
                        am = am*0x10 + rd;      // shift left
                        ae = this.bcdAdd(1, ae, 1, 1);  // --ae
                    }
                }

                this.A.set((sign*0x100 + ae)*0x100000000 + am);
                this.R.set(rm);
            }

            this.execTime += 13 + count*2;
        }
    }

    this.togSIGN = sign;                // for display only
    this.D.set(0);
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
    Forbidden-Combination stop as necessary */
    var ae;                             // dividend/quotient exponent
    var am = this.A.value % 0x10000000000;    // current remainder (A) mantissa
    var aSign = ((this.A.value - am)/0x10000000000) & 0x01;
    var count = 0;                      // count of word-times consumed
    var de;                             // divisor exponent
    var dm = this.D.value % 0x10000000000;    // divisor mantissa
    var dSign = ((this.D.value - dm)/0x10000000000) & 0x01;
    var rd;                             // current quotient (R) digit;
    var rm = this.R.value;                    // current quotient (R) mantissa
    var sign = aSign ^ dSign;           // local copy of sign toggle (sign of quotient)
    var x;                              // digit counter

    this.togMULDIV = 1;                 // for display only
    this.togDELTABDIV = 1;              // for display only
    this.togDIVALARM = 0;               // for display only
    this.SPECIAL = 0;                   // for display only
    ae = (am - am%0x100000000)/0x100000000;
    am %= 0x100000000;
    de = (dm - dm%0x100000000)/0x100000000;
    dm %= 0x100000000;

    // Normalize A & R
    while (am && am < 0x10000000) {
        if (ae <= 0) {
            am = 0;                     // exponent underflow
        } else {
            rd = (rm - rm%0x1000000000)/0x1000000000;
            rm = (rm % 0x1000000000)*0x10;
            am = am*0x10 + rd;      // shift left
            ae = this.bcdAdd(1, ae, 1, 1);      // --ae
        }
    }

    // Normalize D
    while (dm && dm < 0x10000000) {
        if (de <= 0) {
            dm = 0;                     // exponent underflow
        } else {
            dm *= 0x10;                 // shift left
            de = this.bcdAdd(1, de, 1, 1);      // --de
        }
    }

    // Check for zero operands and commence the division
    if (am == 0) {
        this.A.set(0);                  // dividend is zero so result is zero
        this.R.set(0);
        sign = 0;
    } else if (dm == 0) {
        this.A.set(0);                  // divide by zero
        this.R.set(0);
        sign = 0;
        this.togDIVALARM = 1;           // for display only
        this.OFT.set(1);
    } else {
        // Add the exponent bias to the dividend exponent and check for underflow
        ae = this.bcdAdd(ae, 0x50);
        if (ae < de) {
            // Exponents differ by more than 50 -- underflow
            this.A.set(0);
            this.R.set(0);
            sign = 0;
        } else {
            // If dividend >= divisor, scale the exponent by 1
            if (am >= dm) {
                ae = this.bcdAdd(ae, 1);
            }
            // Subtract the exponents and check for overflow
            ae = this.bcdAdd(de, ae, 1, 1);
            if (ae > 0x99) {
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

                for (x=0; x<10; ++x) {
                    // Repeatedly subtract D from A until we would get underflow.
                    // Unlike the 220, we don't do one subtraction too many.
                    rd = 0;
                    while (am >= dm) {
                        am = this.bcdAdd(dm, am, 1, 1);
                        ++rd;
                        ++count;
                    }

                    // Shift A & R to the left one digit, accumulating the quotient digit in R
                    rm = rm*0x10 + rd;
                    rd = (rm - rm%0x10000000000)/0x10000000000;
                    rm %= 0x10000000000;
                    if (x < 9) {
                        am = am*0x10 + rd;      // shift into remainder except on last digit
                    }
                } // for x

                // Rotate the quotient from R into A for 8 digits or until it's normalized
                for (x=0; x<8 || am%0x100000000 < 0x10000000; ++x) {
                    ++this.SPECIAL;         // for display only
                    rd = (am - am%0x1000000000)/0x1000000000;
                    rm = rm*0x10 + rd;
                    rd = (rm - rm%0x10000000000)/0x10000000000;
                    rm %= 0x10000000000;
                    am = (am%0x1000000000)*0x10 + rd;
                }

                this.SHIFTCONTROL = 0x0E;           // for display only
                this.SHIFT = 0x09;                  // for display only
                this.togSTEP = 1;                   // for display only

                this.A.set((sign*0x100 + ae)*0x100000000 + am%0x100000000);
                this.R.set(rm);
            }

            if (this.stopOverflow) {
                this.execTime += 24;
            } else {
                this.execTime += 52 + count*2;
            }
        }
    }

    this.togSIGN = sign;                // for display only
    this.D.set(0);
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
*   Console I/O Module                                                 *
***********************************************************************/

/**************************************/
B220Processor.prototype.consoleOutputSignDigit = function consoleOutputSignDigit() {
    /* Outputs the sign digit for a PTW (03) command and sets up to output the
    first number digit. If the Shift Counter is already at 19, terminates the
    output operation */
    var d;
    var w = this.A.value % 0x10000000000;

    if (this.togPO1) {                  // if false, we've probably been cleared
        d = (this.A.value - w)/0x10000000000; // get the digit
        this.A.set(w*0x10 + d);            // rotate A+sign left one
        if (this.SHIFT == 0x19) {       // if the shift counter is already 19, we're done
            this.togOK = this.togPO1 = 0; // for display only
            this.consoleOutputFinished();
        } else {
            this.togOK = 1-this.togOK;  // for dislay only
            this.togPO2 = 1;            // for display only
            this.togDELAY = 0;          // for display only
            this.console.writeSignDigit(d, this.boundConsoleOutputNumberDigit);
        }
    }
};

/**************************************/
B220Processor.prototype.consoleOutputNumberDigit = function consoleOutputNumberDigit() {
    /* Outputs a numeric digit for a PTW (03) command and sets up to output the
    next number digit. If the Shift Counter is already at 19, terminates the
    output operation and sends a Finish signal */
    var d;
    var w = this.A.value % 0x10000000000;

    if (this.togPO1) {                  // if false, we've probably been cleared
        this.togOK = 1-this.togOK;      // for dislay only
        this.togPO2 = 1-this.togPO2;    // for display only
        this.togDELAY = 1-this.togDELAY;// for display only
        if (this.SHIFT == 0x19) {       // if the shift counter is already 19, we're done
            d = (this.CADDR - this.CADDR%0x1000)/0x1000;
            this.console.writeFinish(d, this.boundConsoleOutputFinished);
        } else {
            d = (this.A.value - w)/0x10000000000; // get the digit
            this.A.set(w*0x10 + d);        // rotate A+sign left one
            this.SHIFT = this.bcdAdd(this.SHIFT, 1);
            this.console.writeNumberDigit(d, this.boundConsoleOutputNumberDigit);
        }
    }
};

/**************************************/
B220Processor.prototype.consoleOutputFinished = function consoleOutputFinished() {
    /* Handles the final cycle of an I/O operation and restores this.execTime */

    if (this.togOK || this.togPO1) {    // if false, we've probably been cleared
        this.togOK = 0;                 // for display only
        this.togPO1 = this.togPO2 = 0;  // for display only
        this.togDELAY = 0;              // for display only
        this.stopIdle = 0;              // turn IDLE lamp back off now that we're done
        this.execTime += performance.now()*B220Processor.wordsPerMilli;
        this.schedule();
    }
};

/**************************************/
B220Processor.prototype.consoleInputDigit = function consoleInputDigit() {
    // Solicits the next input digit from the Control Console */

    this.togTF = 0;                     // for display only, reset finish pulse
    this.execTime -= performance.now()*B220Processor.wordsPerMilli; // mark time during I/O
    this.console.readDigit(this.boundConsoleReceiveDigit);
};

/**************************************/
B220Processor.prototype.consoleReceiveDigit = function consoleReceiveDigit(digit) {
    /* Handles an input digit coming from the Control Console keyboard or
    paper-tape reader. Negative values indicate a finish pulse; otherwise
    the digit is data read from the device. Data digits are rotated into
    the D register; finish pulses are handled according to the sign digit
    in the D register */
    var sign;                           // register sign digit
    var word;                           // register word less sign

    this.execTime += performance.now()*B220Processor.wordsPerMilli; // restore time after I/O
    if (digit >= 0) {
        this.togTC1 = 1-this.togTC1;    // for display only
        this.togTC2 = 1-this.togTC2;    // for display only
        this.D.set((this.D.value % 0x10000000000)*0x10 + digit);
        this.consoleInputDigit();
    } else {
        this.togTF = 1;
        this.togTC1 = this.togTC2 = 0;  // for display only
        word = this.D.value%0x10000000000;
        sign = (this.D.value - word)/0x10000000000; // get D-sign

        if (sign & 0x04) {
            // D-sign is 4, 5, 6, 7: execute a "tape control" command
            this.execTime += 2;
            this.togTF = 0;             // for display only
            this.togSTART = 1-((sign >>> 1) & 0x01); // whether to continue in input mode
            this.setTimingToggle(0);    // Execute mode
            this.togCOUNT = 1;
            this.togBTOAIN = 0;
            this.togADDAB = 1;          // for display only
            this.togADDER = 1;          // for display only
            this.togDPCTR = 1;          // for display only
            this.togCLEAR = 1-(sign & 0x01);
            this.togSIGN = ((this.A.value - this.A.value%0x10000000000)/0x10000000000) & 0x01; // display only
            sign &= 0x08;

            // Increment the destination address (except on the first word)
            this.SHIFTCONTROL = 0x01;   // for display only
            this.SHIFT = 0x13;          // for display only
            if (this.togCOUNT) {
                this.CCONTROL = this.bcdAdd(this.CADDR, 1)%0x10000;
            }

            this.CEXTRA = (this.D.value - word%0x1000000)/0x1000000;
            this.kDigit = (this.CEXTRA >>> 8) & 0x0F;
            // do not set this.selectedUnit from the word -- keep the same unit

            // Shift D5-D10 into C1-C6, modify by B as necessary, and execute
            this.D.set(sign*0x100000 + (word - word%0x1000000)/0x1000000);
            if (this.togCLEAR) {
                word = this.bcdAdd(word%0x1000000, 0);
            } else {
                word = this.bcdAdd(word%0x1000000, this.B.value) % 0x1000000;
            }
            this.SHIFT = 0x19;          // for display only
            this.C.set(word*0x10000 + this.CCONTROL); // put C back together
            this.CADDR = word % 0x10000;
            this.COP = (word - this.CADDR)/0x10000;
            this.execute();
        } else {
            // D-sign is 0, 1, 2, 3: store word, possibly modified by B
            this.execTime += 3;
            this.setTimingToggle(1);    // Fetch mode
            this.togCOUNT = this.togBTOAIN;
            this.togBTOAIN = 1;
            this.togADDAB = 1;          // for display only
            this.togADDER = 1;          // for display only
            this.togDPCTR = 1;          // for display only
            this.togCLEAR = 1-((sign >>> 1) & 0x01);
            this.togSIGN = sign & 0x01;

            // Increment the destination address (except on the first word)
            this.SHIFTCONTROL = 0x01;   // for display only
            this.SHIFT = 0x15;          // for display only
            if (this.togCOUNT) {
                this.CADDR = this.bcdAdd(this.CADDR, 1)%0x10000;
            }
            this.CCONTROL = this.CADDR;
            this.C.set((this.COP*0x10000 + this.CADDR)*0x10000 + this.CCONTROL);

            // Modify the word by B as necessary and store it
            this.D.set((sign & 0x0C)*0x10000000000 + word);
            if (this.togCLEAR) {
                this.A.set(this.bcdAdd(this.D.value, 0));
            } else {
                this.A.set(this.bcdAdd(this.D.value, this.B.value));
            }

            this.D.set(0);
            word = this.A.value % 0x10000000000;
            sign = (((this.A.value - word)/0x10000000000) & 0x0E) | (sign & 0x01);
            this.A.set(sign*0x10000000000 + word);
            this.writeMemory(this.boundConsoleInputDigit, false);
        }
    }
};

/**************************************/
B220Processor.prototype.consoleReceiveSingleDigit = function consoleReceiveSingleDigit(digit) {
    /* Handles a single input digit coming from the Control Console keyboard
    or paper-tape reader, as in the case of Digit Add (10). Negative values
    indicate a finish pulse, which is ignored, and causes another digit to be
    solicited from the Console; otherwise the digit is (virtually) moved to
    the D register and then (actually) added to the A register */
    var sign;                           // register sign digit
    var word;                           // register word less sign

    if (digit < 0) {                    // ignore finish pulse and just re-solicit
        this.console.readDigit(this.boundConsoleReceiveSingleDigit);
    } else {
        this.execTime += performance.now()*B220Processor.wordsPerMilli + 4; // restore time after I/O
        this.togSTART = 0;
        this.D.set(digit);
        this.integerAdd();
        this.schedule();
    }
};

/***********************************************************************
*   Cardatron I/O Module                                               *
***********************************************************************/

/**************************************/
B220Processor.prototype.cardatronOutputWordReady = function cardatronOutputWordReady() {
    /* Successor function for readMemory that sets up the next word of output
    and calls the current ioCallback function to output that word */

    if (this.tog3IO) {                  // if false, we've probably been cleared
        this.SHIFT = 0x09;              // for display only
        this.A.set(this.D.value);                // move D with the memory word to A
        this.togTWA = 1;                // for display only
        this.execTime -= performance.now()*B220Processor.wordsPerMilli;
        this.ioCallback(this.A.value, this.boundCardatronOutputWord, this.boundCardatronOutputFinished);
    }
};

/**************************************/
B220Processor.prototype.cardatronOutputWord = function cardatronOutputWord(receiver) {
    /* Initiates a read of the next word from memory for output to the
    Cardatron Control Unit */

    this.execTime += performance.now()*B220Processor.wordsPerMilli;
    if (this.tog3IO) {                  // if false, we've probably been cleared
        // Increment the source address (except on the first word)
        this.SHIFTCONTROL = 0x01;       // for display only
        this.SHIFT = 0x15;              // for display only
        if (this.togCOUNT) {
            this.CADDR = this.bcdAdd(this.CADDR, 1)%0x10000;
        } else {
            this.togCOUNT = 1;
        }
        this.C.set((this.COP*0x10000 + this.CADDR)*0x10000 + this.CCONTROL);
        this.ioCallback = receiver;
        this.readMemory(this.boundCardatronOutputWordReady);
    }
};

/**************************************/
B220Processor.prototype.cardatronOutputFinished = function cardatronOutputFinished() {
    /* Handles the final cycle of an I/O operation and restores this.execTime */

    if (this.tog3IO) {                  // if false, we've probably been cleared
        this.tog3IO = 0;
        this.togTWA = 0;                // for display only
        this.execTime += performance.now()*B220Processor.wordsPerMilli;
        this.schedule();
    }
};

/**************************************/
B220Processor.prototype.cardatronInputWord = function cardatronInputWord() {
    // Solicits the next input word from the Cardatron Control Unit */

    this.togTF = 0;                     // for display only, reset finish pulse
    this.togTWA = 1;                    // for display only
    this.execTime -= performance.now()*B220Processor.wordsPerMilli; // mark time during I/O
    this.cardatron.inputWord(this.selectedUnit, this.boundCardatronReceiveWord);
};

/**************************************/
B220Processor.prototype.cardatronReceiveWord = function cardatronReceiveWord(word) {
    /* Handles a word coming from the Cardatron input unit. Negative values for
    the word indicate the last word was previously sent and the I/O is finished.
    The word is stored into the D register and is handled according to the sign
    digit in the D register. Any partial word received at the end of the
    I/O is abandoned */
    var sign;                           // D-register sign digit

    this.execTime += performance.now()*B220Processor.wordsPerMilli; // restore time after I/O
    if (word < 0) {
        // Last word received -- finished with the I/O
        this.tog3IO = 0;
        this.togSTART = 0;
        this.togTF = 0;                 // for display only
        this.togTWA = 0;                // for display only
        this.D.set(word-900000000000);     // remove the finished signal; for display only, not stored
        this.schedule();
    } else {
        // Full word accumulated -- process it and initialize for the next word
        this.SHIFT = 0x19;              // for display only
        this.togTF = 1;                 // for display only
        this.D.set(word);
        word %= 0x10000000000;          // strip the sign digit
        sign = (this.D.value - word)/0x10000000000; // get D-sign

        if (sign & 0x04) {
            // D-sign is 4, 5, 6, 7: execute the word as an instruction
            this.execTime += 2;
            this.togTF = 0;             // for display only
            this.togSTART = 1-((sign >>> 1) & 0x01); // whether to continue in input mode
            this.setTimingToggle(0);    // Execute mode
            this.togCOUNT = 0;
            this.togBTOAIN = 0;
            this.togADDAB = 1;          // for display only
            this.togADDER = 1;          // for display only
            this.togDPCTR = 1;          // for display only
            this.togCLEAR = ((this.kDigit & 0x08) ? 1 : 1-(sign & 0x01));
            this.togSIGN = ((this.A.value - this.A.value%0x10000000000)/0x10000000000) & 0x01; // display only

            this.CEXTRA = (this.D - word%0x1000000)/0x1000000;
            this.kDigit = (this.CEXTRA >>> 8) & 0x0F;
            // do not set this.selectedUnit from the word -- keep the same unit

            // Shift D5-D10 into C1-C6, modify by B as necessary, and execute
            if (this.togCLEAR) {
                word = this.bcdAdd(word%0x1000000, 0);
            } else {
                word = this.bcdAdd(word%0x1000000, this.B.value) % 0x1000000;
            }
            this.C.set(word*0x10000 + this.CCONTROL); // put C back together
            this.CADDR = word % 0x10000;
            this.COP = (word - this.CADDR)/0x10000;
            if (sign & 0x02) {          // sign-6 or -7
                this.tog3IO = 0;
                this.togTF = 0;         // for display only
                this.cardatron.inputStop(this.selectedUnit);
                this.execute();
            } else {                    // sign-4 or -5
                /* It's not exactly clear what should happen at this point. The
                documentation states that a sign-4 or -5 word coming from a Cardatron
                input unit can only contain a CDR (44) instruction, which is sensible,
                since sign-4/5 words are generally used to change the destination memory
                address for the data transfer, and the Cardatron presumably still had
                words to transfer. What it doesn't say is what happened if the sign-4/5
                word contained something else. My guess is that either the Processor
                ignored any other op code and proceeded as if it had been a CDR, or more
                likely, things went to hell in a handbasket. The latter is a little
                difficult to emulate, especially since we don't know which hell or
                handbasket might be involved, so we'll assume the former, and just
                continue requesting words from the Cardatron */
                this.SHIFT = 0x09;      // reset shift counter for next word
                this.D.set(0);             // clear D to prepare for next word
                this.cardatronInputWord(); // request the next word
            }
        } else {
            // D-sign is 0, 1, 2, 3, 8, 9: store word, possibly modified by B
            this.execTime += 3;
            this.setTimingToggle(1);    // Fetch mode
            this.togCOUNT = this.togBTOAIN;
            this.togBTOAIN = 1;
            this.togADDAB = 1;          // for display only
            this.togADDER = 1;          // for display only
            this.togDPCTR = 1;          // for display only
            this.togSIGN = sign & 0x01;
            if (this.kDigit & 0x08) {
                this.togCLEAR = 1;
            } else {
                this.togCLEAR = 1-((sign >>> 1) & 0x01);
                sign &= 0x0D;
            }

            // Increment the destination address (except on the first word)
            this.SHIFTCONTROL = 0x01;   // for display only
            this.SHIFT = 0x15;          // for display only
            if (this.togCOUNT) {
                this.CADDR = this.bcdAdd(this.CADDR, 1)%0x10000;
            }
            this.C.set((this.COP*0x10000 + this.CADDR)*0x10000 + this.CCONTROL);

            // Modify the word by B as necessary and store it
            if (this.togCLEAR) {
                word = this.bcdAdd(word, 0);
            } else {
                word = this.bcdAdd(word, this.B.value);
            }

            this.A.set(sign*0x10000000000 + word%0x10000000000);
            this.SHIFT = 0x09;          // reset shift counter for next word
            this.D.set(0);                 // clear D and request the next word after storing this one
            this.writeMemory(this.boundCardatronInputWord, false);
        }
    }
};

/***********************************************************************
*   Magnetic Tape I/O Module                                           *
***********************************************************************/

/**************************************/
B220Processor.prototype.magTapeInitiateSend = function magTapeInitiateSend(writeInitiate) {
    /* Performs the initial memory block-to-loop operation after the tape control
    unit has determined the drive is ready and not busy. Once the initial loop is
    loaded, calls "writeInitiate" to start tape motion, which in turn will cause
    the control to call this.magTapeSendBlock to pass the loop data to the drive
    and initiate loading of the alternate loop buffer */
    var that = this;

    if (this.togMT3P) {                 // if false, we've probably been cleared
        if (this.CADDR >= 0x8000) {
            writeInitiate(this.boundMagTapeSendBlock, this.boundMagTapeTerminateSend);
        } else {
            this.execTime += performance.now()*B220Processor.wordsPerMilli; // restore time after I/O
            this.blockToLoop((this.togMT1BV4 ? 4 : 5), function initialBlockComplete() {
                that.execTime -= performance.now()*B220Processor.wordsPerMilli; // suspend time during I/O
                writeInitiate(that.boundMagTapeSendBlock, that.boundMagTapeTerminateSend);
            });
        }
    }
};

/**************************************/
B220Processor.prototype.magTapeSendBlock = function magTapeSendBlock(lastBlock) {
    /* Sends a block of data from a loop buffer to the tape control unit and
    initiates the load of the alternate loop buffer. this.togMT1BV4 and
    this.togMT1BV5 control alternation of the loop buffers. "lastBlock" indicates
    this will be the last block requested by the control unit and no further
    blocks should be buffered. If the C-register address is 8000 or higher, the
    loop is not loaded from main memory, and the current contents of the loop
    are written to tape. Since tape block writes take 46 ms, they are much
    longer than any memory-to-loop transfer, so this routine simply exits after
    the next blockToLoop is initiated, and the processor then waits for the tape
    control unit to request the next block, by which time the blockToLoop will
    have completed. Returns null if the processor has been cleared and the I/O
    must be aborted */
    var loop;
    var that = this;

    function blockFetchComplete() {
        that.execTime -= performance.now()*B220Processor.wordsPerMilli; // suspend time again during I/O
    }

    //console.log("TSU " + this.selectedUnit + " W, L" + (this.togMT1BV4 ? 4 : 5) +
    //        ", ADDR=" + this.CADDR.toString(16) +
    //        " : " + block[0].toString(16) + ", " + block[19].toString(16));

    if (!this.togMT3P) {
        loop = null;
    } else {
        // Select the appropriate loop to send data to the drive
        if (this.togMT1BV4) {
            loop = this.L4;
            this.toggleGlow.glowL4 = 1; // turn on the lamp and let normal decay work
        } else {
            loop = this.L5;
            this.toggleGlow.glowL5 = 1;
        }

        if (!lastBlock) {
            this.execTime += performance.now()*B220Processor.wordsPerMilli; // restore time after I/O
            // Flip the loop-buffer toggles
            this.togMT1BV5 = this.togMT1BV4;
            this.togMT1BV4 = 1-this.togMT1BV4;
            // Block the loop buffer from main memory if appropriate
            if (this.CADDR < 0x8000) {
                this.blockToLoop((this.togMT1BV4 ? 4 : 5), blockFetchComplete);
            } else {
                blockFetchComplete();
            }
        }

        this.A.set(loop[loop.length-1]);   // for display only
        this.D.set(0);                     // for display only
    }

    return loop;                        // give the loop data to the control unit
};

/**************************************/
B220Processor.prototype.magTapeTerminateSend = function magTapeTerminateSend() {
    /* Called by the tape control unit after the last block has been completely
    written to tape. Terminates the write instruction */

    if (this.togMT3P) {                 // if false, we've probably been cleared
        this.togMT3P = 0;
        this.togMT1BV4 = this.togMT1BV5 = 0;
        this.execTime += performance.now()*B220Processor.wordsPerMilli; // restore time after I/O
        this.schedule();
    }
};

/**************************************/
B220Processor.prototype.magTapeReceiveBlock = function magTapeReceiveBlock(block, lastBlock) {
    /* Called by the tape control unit to store a block of 20 words. If "lastBlock" is
    true, it indicates this is the last block and the I/O is finished. If "block"
    is null, that indicates the I/O was aborted and the block must not be stored
    in memory. The block is stored in one of the loops, as determined by the
    togMT1BV4 and togMT1BV5 control toggles. Sign digit adjustment and B-register
    modification take place at this time. If the C-register operand address is
    less than 8000, the loop is then stored at the current operand address, which
    is incremented by blockFromLoop(). If this is the last block, schedule()
    is called after the loop is stored to terminate the read instruction. Since
    tape block reads take 46 ms, they are much longer than any loop-to-memory
    transfer, so this routine simply exits after the blockFromLoop is initiated,
    and the then processor waits for the next block to arrive from the tape, by
    which time the blockFromLoop will (should?) have completed. Returns true if
    the processor has been cleared and the tape control unit should abort the I/O */
    var aborted = false;                // return value
    var loop;
    var sign;                           // sign digit
    var that = this;
    var w;                              // scratch word
    var x;                              // scratch index

    function blockStoreComplete() {
        if (lastBlock) {
            if (that.togMT3P) {         // if false, we've probably been cleared
                that.A = that.D = 0;    // for display only
                that.togMT3P = 0;
                that.togMT1BV4 = that.togMT1BV5 = 0;
                that.schedule();
            }
        } else {
            // Flip the loop buffer toggles
            that.togMT1BV5 = that.togMT1BV4;
            that.togMT1BV4 = 1-that.togMT1BV4;
            // Suspend time again during I/O
            that.execTime -= performance.now()*B220Processor.wordsPerMilli;
        }
    }

    //console.log("TSU " + this.selectedUnit + " R, L" + (this.togMT1BV4 ? 4 : 5) +
    //        ", ADDR=" + this.CADDR.toString(16) +
    //        " : " + block[0].toString(16) + ", " + block[19].toString(16));

    if (!this.togMT3P) {                // if false, we've probably been cleared
        aborted = true;
    } else {
        this.execTime += performance.now()*B220Processor.wordsPerMilli; // restore time after I/O
        // Select the appropriate loop to receive data from the drive
        if (this.togMT1BV4) {
            loop = this.L4;
            this.toggleGlow.glowL4 = 1; // turn on the lamp and let normal decay work
        } else {
            loop = this.L5;
            this.toggleGlow.glowL5 = 1;
        }

        if (!block) {                   // control unit aborted the I/O
            blockStoreComplete();
        } else {
            // Copy the tape block data to the appropriate high-speed loop
            for (x=0; x<loop.length; ++x) {
                this.D.set(w = block[x]);  // D for display only
                if (w < 0x20000000000) {
                    this.togCLEAR = 1;  // no B modification
                } else {
                    // Adjust sign digit and do B modification as necessary
                    sign = ((w - w%0x10000000000)/0x10000000000) % 0x08; // low-order 3 bits only
                    if (this.tswSuppressB) {
                        this.togCLEAR = 1;  // no B modification
                    } else {
                        this.togCLEAR = ((sign & 0x02) ? 0 : 1);
                        sign &= 0x01;
                    }

                    w = sign*0x10000000000 + w%0x10000000000;
                }

                if (this.togCLEAR) {
                    w = this.bcdAdd(w, 0);
                } else {
                    w = this.bcdAdd(w, this.B.value);
                }

                loop[x] = w;
            } // for x

            this.A.set(w);                 // for display only

            // Block the loop buffer to main memory if appropriate
            if (this.CADDR < 0x8000) {
                this.blockFromLoop((this.togMT1BV4 ? 4 : 5), blockStoreComplete);
            } else {
                blockStoreComplete();
            }
        }
    }

    return aborted;
};


/***********************************************************************
*   Fetch Module                                                       *
***********************************************************************/

/**************************************/
B220Processor.prototype.fetch = function fetch() {
    /* Implements the Fetch cycle of the 220 processor. This is initiated either
    by pressing START on the Console with EXT=0 (Fetch), pressing STEP on the
    Console when the computer is stopped and EXT=0, during I/O when a control
    word (sign>3) is received from a peripheral device, or by the prior
    Operation Complete if the processor is in continuous mode. Note that the
    time for fetch is built into the individual instruction times, and is
    accumulated here only if the Execute phase is skipped */
    var dSign;                          // sign bit of IB register
    var word;                           // instruction word

    if (this.AST.value) {               // if doing I/O
        word = this.IB.value;
    } else {                            // if doing normal fetch
        this.E.set(this.P.value);
        word = this.readMemory();
    }

    if (!this.MET.value) {
        // if we're not locked in Fetch, switch to Execute phase next.
        if (this.FETCHEXECUTELOCKSW) {
            this.execTime += 0.090;         // fetch uniformly requires 90 us
        } else {
            this.EXT.set(1);
        }

        dSign = ((word - word%0x10000000000)/0x10000000000) & 0x01;
        this.DST.set(dSign);
        // (should set IB sign bit 1=0 here, but to reduce overhead we don't bother)

        this.CADDR = word%0x10000;                                      // C address
        this.COP = (word%0x1000000 - this.CADDR)/0x10000;               // C op code
        this.CCONTROL = (word%10000000000 - word%1000000)/0x1000000;    // C control digits
        if (dSign) {
            this.CADDR = this.bcdAdd(this.CADDR, this.B.value) % 0x10000;
            this.C10.set(0);                                            // reset carry toggle
            this.C.set((this.CCONTROL*100 + this.COP)*10000 + this.CADDR);
        } else {
            this.C.set(word%0x10000000000);
        }

        this.D.set(word);               // D contains a copy of memory word
        if (!this.AST.value && !this.PCOUNTSW) {
            this.P.add(0x01);           // if not doing I/O, bump the program counter
        }
    }
};


/***********************************************************************
*   Execute Module                                                     *
***********************************************************************/

/**************************************/
B220Processor.prototype.executeWithOperand = function executeWithOperand() {
    /* Executes an instruction that requires an operand, after that operand
    has been read from memory into the D register */

    switch (this.COP) {
    case 0x60:          //---------------- M    Multiply
        this.integerMultiply(false);
        break;

    case 0x61:          //---------------- Div  Divide
        this.integerDivide();
        break;

    // 0x62:            //---------------- (no op)
        break;

    case 0x63:          //---------------- EX   Extract
        this.execTime += 3;
        this.integerExtract();
        break;

    case 0x64:          //---------------- CAD  Clear and Add A
        this.execTime += 3;
        this.A.set(this.bcdAdd(0, this.D.value));
        this.D.set(0);
        break;

    case 0x65:          //---------------- CSU  Clear and Subtract A
        this.execTime += 3;
        // Complement the D sign -- any sign overflow will be ignored by integerAdd
        this.A.set(this.bcdAdd(0, B220Processor.bitFlip(this.D.value, 40)));
        this.D.set(0);
        break;

    case 0x66:          //---------------- CADA Clear and Add Absolute
        this.execTime += 3;
        this.A.set(this.bcdAdd(0, B220Processor.bitReset(this.D.value, 40)));
        this.D.set(0);
        break;

    case 0x67:          //---------------- CSUA Clear and Subtract Absolute
        this.execTime += 3;
        this.A.set(this.bcdAdd(0, B220Processor.bitSet(this.D.value, 40)));
        this.D.set(0);
        break;

    // 0x68-0x69:       //---------------- (no op)

    case 0x70:          //---------------- MRO  Multiply and Round
        this.integerMultiply(true);
        break;

    case 0x71:          //---------------- EXC  External Control
        this.setExternalSwitches();
        break;

    case 0x72:          //---------------- SB   Set B
        this.execTime += 3;
        this.SHIFT = 0x15;                              // for display only
        this.SHIFTCONTROL = 0;                          // for display only
        this.togADDAB = 1;                              // for display only
        this.togCLEAR = 1;                              // for display only
        this.DELTABDIVT = 1;                            // for display only
        this.B.set(this.bcdAdd(0, this.D.value % 0x10000));
        this.togSIGN = ((this.A.value - this.A.value%0x10000000000)/0x10000000000) & 0x01; // for display only
        this.D.set(0);
        break;

    case 0x73:          //---------------- OSGD Overflow on Sign Difference
        this.execTime += 2;
        this.togSIGN = ((this.A.value - this.A.value%0x10000000000)/0x10000000000) & 0x01; // for display, mostly
        this.OFT.set(this.togSIGN ^
                (((this.D.value - this.D.value%0x10000000000)/0x10000000000) & 0x01));
        this.D.set(0);
        break;

    case 0x74:          //---------------- AD   Add
        this.execTime += 3;
        this.integerAdd();
        break;

    case 0x75:          //---------------- SU   Subtract
        this.execTime += 3;
        this.D.set(B220Processor.bitFlip(this.D.value, 40));     // complement the D sign
        this.integerAdd();
        break;

    case 0x76:          //---------------- ADA  Add Absolute
        this.execTime += 3;
        this.D.set(B220Processor.bitReset(this.D.value, 40));    // clear the D sign
        this.integerAdd();
        break;

    case 0x77:          //---------------- SUA  Subtract Absolute
        this.execTime += 3;
        this.D.set(B220Processor.bitSet(this.D.value, 40));     // set the D sign
        this.integerAdd();
        break;

    // 0x78-0x79:       //---------------- (no op)

    case 0x80:          //---------------- FAD  Floating Add
        this.execTime += 4;
        this.floatingAdd();
        break;

    case 0x81:          //---------------- FSU  Floating Subtract
        this.execTime += 4;
        // Complement the D sign -- any sign overflow will be ignored by floatingAdd.
        this.D.flipBit(40);
        this.floatingAdd();
        break;

    case 0x82:          //---------------- FM   Floating Multiply
        this.execTime += 3;
        this.floatingMultiply();
        break;

    case 0x83:          //---------------- FDIV Floating Divide
        this.execTime += 3;
        this.floatingDivide();
        break;

    // 0x84:            //---------------- (no op)

    case 0x85:          //---------------- MSH  Memory Search High (Eaton CER)
        this.searchMemory(true);
        return;                         // avoid the schedule()
        break;

    // 0x86:            //---------------- (no op)

    case 0x87:          //---------------- MSE  Memory Search Equal (Eaton CER)
        this.searchMemory(false);
        return;                         // avoid the schedule()
        break;

    // 0x88-0x89:       //---------------- (no op)

    case 0x90:          //---------------- FAA  Floating Add Absolute
        this.execTime += 4;
        this.D.value %= 0x10000000000;        // clear the D-sign digit
        this.floatingAdd();
        break;

    case 0x91:          //---------------- FSA  Floating Subtract Absolute
        this.execTime += 4;
        this.D.set(this.D.value%0x10000000000 + 0x10000000000); // set the D-sign
        this.floatingAdd();
        break;

    case 0x92:          //---------------- FMA  Floating Multiply Absolute
        this.execTime += 3;
        this.D.value %= 0x10000000000;        // clear the D-sign digit
        this.floatingMultiply();
        break;

    case 0x93:          //---------------- FDA  Floating Divide Absolute
        this.execTime += 3;
        this.D.value %= 0x10000000000;        // clear the D-sign digit
        this.floatingDivide();
        break;

    // 0x94-0x99:       //---------------- (no op)

    } // switch this.COP
};

/**************************************/
B220Processor.prototype.execute = function execute() {
    /* Implements the Execute cycle of the 220 processor. This is initiated either
    by pressing START on one of the consoles with the EXT=1 (Execute),
    or by the prior operation complete if the processor is in continuous mode */
    var d;                              // scratch digit
    var w;                              // scratch word
    var x;                              // scratch variable or counter

    w = this.C.value;
    this.CCONTROL = (w - w%0x1000000)/0x1000000;        // C register control digits
    this.COP = (w%0x1000000 - w%0x10000)/0x10000;       // C register operation code
    this.CADDR = w%0x10000;                             // C register operand address

    // If we're not locked in Execute, switch to Fetch phase next.
    if (this.FETCHEXECUTELOCKSW != 1) {
        this.EXT.set(0);
    }

    if (this.OFT.value && this.HCT.value && this.COP != 0x31) {
        this.stop();                    // if overflow and SOH and instruction is not BOF, stop
        return;
    }

    if (B220Processor.operandRequired[this.COP]) {
        this.E.set(this.CADDR);
        this.readMemory();
        if (this.MET.value) {           // invalid address
            this.setStorageCheck(1);
            return;
        }
    }

    switch (this.COP) {
    case 0x00:      //--------------------- HLT     Halt
        this.RUT.set(0);
        this.execTime += 0.100;
        break;

    case 0x01:      //--------------------- NOP     No operation
        // do nothing
        this.execTime += 0.100;
        break;

    case 0x03:      //--------------------- PRD     Paper tape read
        this.setProgramCheck(1);
        break;

    case 0x04:      //--------------------- PRB     Paper tape read, branch
        this.setProgramCheck(1);
        break;

    case 0x05:      //--------------------- PRI     Paper tape read, inverse format
        this.setProgramCheck(1);
        break;

    case 0x06:      //--------------------- PWR     Paper tape write
        this.setProgramCheck(1);
        break;

    case 0x08:      //--------------------- KAD     Keyboard add
        this.setProgramCheck(1);
        break;

    case 0x09:      //--------------------- SPO     Supervisory print-out
        this.setProgramCheck(1);
        break;

    case 0x10:      //--------------------- CAD/CAA Clear add/add absolute
        this.SUT.set(0);
        this.A.value = 0;
        if (this.CCONTROL % 0x10 == 1) {
            this.IB.value = B220Processor.bitReset(this.IB.value, 40);
        }

        this.integerAdd();
        break;

    case 0x11:      //--------------------- CSU/CSA Clear subtract/subtract absolute
        this.SUT.set(1);
        this.A.value = 0;
        if (this.CCONTROL % 0x10 == 1) {
            this.IB.value = B220Processor.bitSet(this.IB.value, 40);
        } else {
            this.IB.value = B220Processor.bitFlip(this.IB.value, 40);
        }

        this.integerAdd();
        break;

    case 0x12:      //--------------------- ADD/ADA Add/add absolute
        this.SUT.set(0);
        if (this.CCONTROL % 0x10 == 1) {
            this.IB.value = B220Processor.bitReset(this.IB.value, 40);
        }

        this.integerAdd();
        break;

    case 0x13:      //--------------------- SUB/SUA Subtract/subtract absolute
        this.SUT.set(1);
        if (this.CCONTROL % 0x10 == 1) {
            this.IB.value = B220Processor.bitSet(this.IB.value, 40);
        } else {
            this.IB.value = B220Processor.bitFlip(this.IB.value, 40);
        }

        this.integerAdd();
        break;

    case 0x14:      //--------------------- MUL     Multiply
        this.setProgramCheck(1);
        break;

    case 0x15:      //--------------------- DIV     Divide
        this.setProgramCheck(1);
        break;

    case 0x16:      //--------------------- RND     Round
        this.setProgramCheck(1);
        break;

    case 0x17:      //--------------------- EXT     Extract
        this.setProgramCheck(1);
        break;

    case 0x18:      //--------------------- CFA/CFR Compare field A/R
        this.setProgramCheck(1);
        break;

    case 0x19:      //--------------------- ADL     Add to location
        this.setProgramCheck(1);
        break;

    case 0x20:      //--------------------- IBB     Increase B, branch
        this.setProgramCheck(1);
        break;

    case 0x21:      //--------------------- DBB     Decrease B, branch
        this.setProgramCheck(1);
        break;

    case 0x22:      //--------------------- FAD/FAA Floating add/add absolute
        this.setProgramCheck(1);
        break;

    case 0x23:      //--------------------- FSU/FSA Floating subtract/subtract absolute
        this.setProgramCheck(1);
        break;

    case 0x24:      //--------------------- FMU     Floating multiply
        this.setProgramCheck(1);
        break;

    case 0x25:      //--------------------- FDV     Floating divide
        this.setProgramCheck(1);
        break;

    case 0x26:      //--------------------- IFL     Increase field location
        this.setProgramCheck(1);
        break;

    case 0x27:      //--------------------- DFL     Decrease field location
        this.setProgramCheck(1);
        break;

    case 0x28:      //--------------------- DLB     Decrease field location, load B
        this.setProgramCheck(1);
        break;

    case 0x29:      //--------------------- RTF     Record transfer
        this.setProgramCheck(1);
        break;

    case 0x30:      //--------------------- BUN     Branch, unconditionally
        this.P.set(this.CADDR);
        this.execTime += 0.125;

        break;

    case 0x31:      //--------------------- BOF     Branch, overflow
        this.setProgramCheck(1);
        break;

    case 0x32:      //--------------------- BRP     Branch, repeat
        this.setProgramCheck(1);
        break;

    case 0x33:      //--------------------- BSA     Branch, sign A
        this.setProgramCheck(1);
        break;

    case 0x34:      //--------------------- BCH/BCL Branch, comparison high/low
        this.setProgramCheck(1);
        break;

    case 0x35:      //--------------------- BCE/BCU Branch, comparison equal/unequal
        this.setProgramCheck(1);
        break;

    case 0x36:      //--------------------- BFA     Branch, field A
        this.setProgramCheck(1);
        break;

    case 0x37:      //--------------------- BFR     Branch, field R
        this.setProgramCheck(1);
        break;

    case 0x38:      //--------------------- BCS     Branch, control switch
        this.setProgramCheck(1);
        break;

    case 0x39:      //--------------------- SO*/IOM Set overflow remember/halt, Interrogate overflow mode
        this.setProgramCheck(1);
        break;

    case 0x40:      //--------------------- ST*     Store A/R/B
        this.setProgramCheck(1);
        break;

    case 0x41:      //--------------------- LDR     Load R
        this.setProgramCheck(1);
        break;

    case 0x42:      //--------------------- LDB/LBC Load B/B complement
        this.setProgramCheck(1);
        break;

    case 0x43:      //--------------------- LSA     Load sign A
        this.setProgramCheck(1);
        break;

    case 0x44:      //--------------------- STP     Store P
        this.setProgramCheck(1);
        break;

    case 0x45:      //--------------------- CL*     Clear A/R/B
        this.setProgramCheck(1);
        break;

    case 0x46:      //--------------------- CLL     Clear location
        this.setProgramCheck(1);
        break;

    case 0x48:      //--------------------- SR*     Shift right A/A and R/A with sign
        this.setProgramCheck(1);
        break;

    case 0x49:      //--------------------- SL*     Shift left A/A and R/A with sign
        this.setProgramCheck(1);
        break;

    case 0x50:      //--------------------- MT*     Magnetic tape search/field search/lane select/rewind
        this.setProgramCheck(1);
        break;

    case 0x51:      //--------------------- MTC/MFC Magnetic tape scan/field scan
        this.setProgramCheck(1);
        break;

    case 0x52:      //--------------------- MRD     Magnetic tape read
        this.setProgramCheck(1);
        break;

    case 0x53:      //--------------------- MRR     Magnetic tape read, record
        this.setProgramCheck(1);
        break;

    case 0x54:      //--------------------- MIW     Magnetic tape initial write
        this.setProgramCheck(1);
        break;

    case 0x55:      //--------------------- MIR     Magnetic tape initial write, record
        this.setProgramCheck(1);
        break;

    case 0x56:      //--------------------- MOW     Magnetic tape overwrite
        this.setProgramCheck(1);
        break;

    case 0x57:      //--------------------- MOR     Magnetic tape overwrite, record
        this.setProgramCheck(1);
        break;

    case 0x58:      //--------------------- MPF/MPB Magnetic tape position forward/backward/at end
        this.setProgramCheck(1);
        break;

    case 0x59:      //--------------------- MIB/MIE Magnetic tape interrogate, branch/end of tape, branch
        this.setProgramCheck(1);
        break;

    case 0x60:      //--------------------- CRD     Card read
        this.setProgramCheck(1);
        break;

    case 0x61:      //--------------------- CWR     Card write
        this.setProgramCheck(1);
        break;

    case 0x62:      //--------------------- CRF     Card read, format load
        this.setProgramCheck(1);
        break;

    case 0x63:      //--------------------- CWF     Card write, format load
        this.setProgramCheck(1);
        break;

    case 0x64:      //--------------------- CRI     Card read interrogate, branch
        this.setProgramCheck(1);
        break;

    case 0x65:      //--------------------- CWI     Card write interrogate, branch
        this.setProgramCheck(1);
        break;

    case 0x66:      //--------------------- HPW     High speed printer write
        this.setProgramCheck(1);
        break;

    case 0x67:      //--------------------- HPI     High speed printer interrogate, branch
        this.setProgramCheck(1);
        break;

    default:        //--------------------- Invalid op code -- set Program Check alarm
        this.setProgramCheck(1);
        break;
    } // switch this.COP

    /***************************************************************************


        switch (-1) {
        case 0x00:      //---------------- PTR  Paper-tape/keyboard read
            this.D.set(0);
            this.togSTART = 1;
            this.consoleInputDigit();
            break;

        case 0x01:      //---------------- CIRA Circulate A
            x = B220Processor.bcdBinary(this.CADDR % 0x20);
            this.execTime += x+8;
            x = 19-x;
            this.SHIFT = B220Processor.binaryBCD(x);    // for display only
            this.togDELAY = 1;                          // for display only
            w = this.A.value;
            for (; x<=19; ++x) {
                d = (w - w%0x10000000000)/0x10000000000;
                w = (w%0x10000000000)*0x10 + d;
            }
            this.A.set(w);
            break;

        case 0x02:      //---------------- STC  Store and Clear A
            this.execTime += 1;
            break;

        case 0x03:      //---------------- PTW  Paper-tape/Flexowriter write
            if (this.cswPOSuppress) {
                //this.schedule();                 // ignore printout commands
            } else if (this.cswOutput == 0) {
                this.togCST = 1;                        // halt if Output switch is OFF
                //this.schedule();
            } else {
                this.togPO1 = 1;                        // for display only
                this.SHIFT = this.bcdAdd(this.CADDR%0x20, 0x19, 1, 1);  // 19-n
                this.execTime -= performance.now()*B220Processor.wordsPerMilli; // mark time during I/O
                this.stopIdle = 1;                      // turn IDLE lamp on in case Output Knob is OFF
                d = (this.CADDR%0x1000 - this.CADDR%0x100)/0x100;
                if (d) {                                // if C8 is not zero, output it first as the format digit
                    this.togOK = this.togDELAY = 1;     // for display only
                    this.console.writeFormatDigit(d, this.boundConsoleOutputSignDigit);
                } else {
                    this.consoleOutputSignDigit();
                }
            }
            break;

        case 0x04:      //---------------- CNZ  Change on Non-Zero
            this.execTime += 3;
            this.togZCT = 1;                            // for display only
            this.D.set(0);
            this.integerAdd();                          // clears the sign digit, among other things
            if (this.A.value) {
                this.setTimingToggle(0);                // stay in Execute
                this.OFT.set(1);                    // set overflow
                this.COP = 0x28;                        // make into a CC
                this.C.set((this.CCONTROL*0x100 + this.COP)*0x10000 + this.CADDR);
            }
            break;

        // 0x05:        //---------------- (no op)

        case 0x06:      //---------------- UA   Unit Adjust
            this.execTime += 2;
            if (this.A.value % 2 == 0) {
                ++this.A.value;
            }
            break;

        case 0x07:      //---------------- PTWF Paper-tape Write Format
            if (this.cswPOSuppress) {
                //this.schedule();                 // ignore printout commands
            } else if (this.cswOutput == 0) {
                this.togCST = 1;                        // halt if Output switch is OFF
                //this.schedule();
            } else {
                this.execTime -= performance.now()*B220Processor.wordsPerMilli; // mark time during I/O
                this.stopIdle = 1;                      // turn IDLE lamp on in case Output Knob is OFF
                d = (this.CADDR%0x1000 - this.CADDR%0x100)/0x100;
                if (d) {                                // if C8 is not zero, output it as the format digit
                    this.togOK = this.togDELAY = 1;
                    this.console.writeFormatDigit(d, this.boundConsoleOutputFinished);
                } else {
                    this.consoleOutputFinished();
                }
            }
            break;

        // 0x08:        //---------------- HALT [was handled above]

        // 0x09:        //---------------- (no op)

        case 0x10:      //---------------- DAD  Digit Add from keyboard to A
            this.togSTART = 1;
            this.execTime -= performance.now()*B220Processor.wordsPerMilli; // mark time during I/O
            this.console.readDigit(this.boundConsoleReceiveSingleDigit);
            break;

        case 0x11:      //---------------- BA   B to A transfer
            this.execTime += 3;
            this.togBTOAIN = 1;                         // for display only
            this.togADDAB = 1;                          // for display only
            this.togDELTABDIV = 1;                      // for display only
            this.SHIFT = 0x15;                          // for display only
            this.A.set(this.bcdAdd(0, this.B.value));
            //this.schedule();
            break;

        case 0x12:      //---------------- ST   Store A
            this.execTime += 1;
            this.writeMemory(this.schedule, false);
            break;

        case 0x13:      //---------------- SR   Shift Right A & R
            x = B220Processor.bcdBinary(this.CADDR % 0x20);
            this.execTime += (x < 12 ? 2 : 3);
            x = 19-x;
            this.SHIFT = B220Processor.binaryBCD(x);    // for display only
            this.SHIFTCONTROL = 0x04;                   // for display only
            w = this.A.value % 0x10000000000;                 // A sign is not affected
            for (; x<19; ++x) {
                d = w % 0x10;
                w = (w-d)/0x10;
                this.R.set((this.R.value - this.R.value % 0x10)/0x10 + d*0x1000000000);
            }
            this.A.value += w - this.A.value%0x10000000000;         // restore the sign <<??>>
            break;

        case 0x14:      //---------------- SL   Shift Left A & R
            x = B220Processor.bcdBinary(this.CADDR % 0x20);
            this.execTime += (x < 9 ? 3 : 2);
            this.SHIFT = B220Processor.binaryBCD(x);    // for display only
            this.SHIFTCONTROL = 0x06;                   // for display only
            w = this.A.value % 0x10000000000;                 // A sign is not affected
            for (; x<=19; ++x) {
                d = this.R.value % 0x10;
                this.R.set((this.R.value - d)/0x10);
                d = (w += d*0x10000000000)%0x10;
                w = (w-d)/0x10;
                this.R.value += d*0x1000000000;
            }
            this.A.value += w - this.A.value%0x10000000000;         // restore the sign <<??>>
            break;

        case 0x15:      //---------------- NOR  Normalize A & R
            this.togZCT = 1;                            // for display only
            this.SHIFTCONTROL = 0x02;                   // for display only
            w = this.A.value % 0x10000000000;                 // A sign is not affected
            x = 0;
            do {
                d = (w - w%0x1000000000)/0x1000000000;
                if (d) {
                    break;                              // out of do loop
                } else {
                    ++x;                                // count the shifts
                    d = this.R.value % 0x1000000000;          // shift A and R left
                    w = w*0x10 + (this.R.value - d)/0x1000000000;
                    this.R.set(d*0x10);
                }
            } while (x < 10);
            this.A.value += w - this.A.value%0x10000000000;         // restore the sign <<??>>
            this.execTime += (x+1)*2;

            this.SPECIAL = x;                           // the result
            this.SHIFTCONTROL |= 0x04;                  // for display only
            this.SHIFT = 0x19;                          // for display only
            if (x < 10) {
            } else {
                this.setTimingToggle(0);                // stay in Execute
                this.OFT.set(1);                    // set overflow
                this.COP = 0x28;                        // make into a CC
                this.C.set((this.CCONTROL*0x100 + this.COP)*0x10000 + this.CADDR);
            }
            break;

        case 0x16:      //---------------- ADSC Add Special Counter to A
            this.execTime += 3;
            this.D.set(this.SPECIAL);
            this.integerAdd();
            break;

        case 0x17:      //---------------- SUSC Subtract Special Counter from A
            this.execTime += 3;
            this.D.set(this.SPECIAL + 0x10000000000);      // set to negative
            this.integerAdd();
            break;

        // 0x18-0x19:   //---------------- (no op)

        case 0x20:      //---------------- CU   Change Unconditionally
            this.execTime += 2;
            this.SHIFT = 0x15;                          // for display only
            this.SHIFTCONTROL = 0x07;                   // for display only
            this.P = this.CADDR;                 // copy address to control counter
            break;

        case 0x21:      //---------------- CUR  Change Unconditionally, Record
            this.execTime += 2;
            this.SHIFT = 0x15;                          // for display only
            this.SHIFTCONTROL = 0x07;                   // for display only
            this.R.set(this.CCONTROL*0x1000000);           // save current control counter
            this.CCONTROL = this.CADDR;                 // copy address to control counter
            this.C.set((this.COP*0x10000 + this.CADDR)*0x10000 + this.CCONTROL);
            break;

        case 0x22:      //---------------- DB   Decrease B and Change on Negative
            this.execTime += 3;
            this.togADDAB = 1;                          // for display only
            this.togDELTABDIV = 1;                      // for display only
            this.togZCT = 1;                            // for display only
            this.SHIFT = 0x15;                          // for display only
            if (this.B.value == 0) {
                this.B.set(0x9999);
            } else {
                this.B.set(this.bcdAdd(this.B.value, 0x9999) % 0x10000); // add -1
                this.setTimingToggle(0);                // stay in Execute
                this.OFT.set(1);                    // set overflow
                this.COP = 0x28;                        // make into a CC
                this.C.set((this.COP*0x10000 + this.CADDR)*0x10000 + this.CCONTROL);
            }
            this.togSIGN = ((this.A.value - this.A.value%0x10000000000)/0x10000000000) & 0x01; // display only
            this.D.set(0);
            break;

        case 0x23:      //---------------- RO   Round A, Clear R
            this.execTime += 3;
            this.togSIGN = ((this.A.value - this.A.value%0x10000000000)/0x10000000000) & 0x01;
            // Add round-off (as the carry bit) to absolute value of A.
            this.A.set(this.bcdAdd(this.A.value%0x10000000000, 0, 0, (this.R.value < 0x5000000000 ? 0 : 1)));
            if (this.A.value >= 0x10000000000) {
                this.OFT.set(1);                    // overflow occurred
                this.A.value -= 0x10000000000;                // remove the overflow bit <<??>>
            }
            this.A.value += this.togSIGN*0x10000000000;       // restore the sign bit in A <<??>>
            this.D.set(0);                              // clear D & R
            this.R.set(0);
            break;

        case 0x24:      //---------------- BF4  Block from 4000 Loop
        case 0x25:      //---------------- BF5  Block from 5000 loop
        case 0x26:      //---------------- BF6  Block from 6000 loop
        case 0x27:      //---------------- BF7  Block from 7000 loop
            this.execTime +=2;
            this.blockFromLoop(this.COP-0x20, this.schedule);
            break;

        case 0x28:      //---------------- CC   Change Conditionally
            if (!this.stopOverflow) {                   // check if branch should occur
                this.execTime += 1;
                this.SHIFTCONTROL = 0x04;               // no -- set for display only
            } else {
                this.execTime += 2;
                this.OFT.set(0);                    // reset overflow and do the branch
                this.SHIFT = 0x15;                      // for display only
                this.SHIFTCONTROL = 0x07;               // for display only
                this.CCONTROL = this.CADDR;             // copy address to control counter
                this.C.set((this.COP*0x10000 + this.CADDR)*0x10000 + this.CCONTROL);
            }
            break;

        case 0x29:      //---------------- CCR  Change Conditionally, Record
            if (!this.stopOverflow) {                   // check if branch should occur
                this.execTime += 1;
                this.SHIFTCONTROL = 0x04;               // for display only
            } else {
                this.execTime += 2;
                this.OFT.set(0);                    // reset overflow and do the branch
                this.SHIFT = 0x15;                      // for display only
                this.SHIFTCONTROL = 0x07;               // for display only
                this.R.set(this.CCONTROL*0x1000000);       // save current control counter
                this.CCONTROL = this.CADDR;             // copy address to control counter
                this.C.set((this.COP*0x10000 + this.CADDR)*0x10000 + this.CCONTROL);
            }
            break;

        case 0x30:      //---------------- CUB  Change Unconditionally, Block to 7000 Loop
            this.execTime += 4;
            this.SHIFT = 0.15;                          // for display only
            this.SHIFTCONTROL = 0x0F;                   // for display only
            this.CCONTROL = this.CADDR%0x100 + 0x7000;  // set control to loop-7 address
            this.C.set((this.COP*0x10000 + this.CADDR)*0x10000 + this.CCONTROL);
            this.blockToLoop(7, this.schedule);
            break;

        case 0x31:      //---------------- CUBR Change Unconditionally, Block to 7000 Loop, Record
            this.execTime += 4;
            this.SHIFT = 0.15;                          // for display only
            this.SHIFTCONTROL = 0x0F;                   // for display only
            this.R.set(this.CCONTROL*0x1000000);           // save current control counter
            this.CCONTROL = this.CADDR%0x100 + 0x7000;  // set control to loop-7 address
            this.C.set((this.COP*0x10000 + this.CADDR)*0x10000 + this.CCONTROL);
            this.blockToLoop(7, this.schedule);
            break;

        case 0x32:      //---------------- IB   Increase B
            this.execTime += 3;
            this.togADDAB = 1;                          // for display only
            this.togDELTABDIV = 1;                      // for display only
            this.togZCT = 1;                            // for display only
            this.SHIFT = 0x15;                          // for display only
            this.B.set(this.bcdAdd(this.B.value, 1) % 0x10000);  // discard any overflow in B
            this.togSIGN = ((this.A.value - this.A.value%0x10000000000)/0x10000000000) & 0x01; // display only
            this.D.set(0);
            break;

        case 0x33:      //---------------- CR   Clear R
            this.execTime += 2;
            this.SHIFTCONTROL = 0x04;                   // for display only
            this.R.set(0);
            break;

        case 0x34:      //---------------- BT4  Block to 4000 Loop
        case 0x35:      //---------------- BT5  Block to 5000 Loop
        case 0x36:      //---------------- BT6  Block to 6000 Loop
        case 0x37:      //---------------- BT7  Block to 7000 Loop
            this.execTime +=2;
            this.blockToLoop(this.COP-0x30, this.schedule);
            break;

        case 0x38:      //---------------- CCB  Change Conditionally, Block to 7000 Loop
            if (!this.stopOverflow) {                   // check if branch should occur
                this.execTime += 3;
                this.SHIFTCONTROL = 0x04;               // for display only
            } else {
                this.execTime += 4;
                this.OFT.set(0);                    // reset overflow and do the branch
                this.SHIFT = 0x15;                      // for display only
                this.SHIFTCONTROL = 0x0F;               // for display only
                this.CCONTROL = this.CADDR%0x100 + 0x7000;  // set control to loop-7 address
                this.C.set((this.COP*0x10000 + this.CADDR)*0x10000 + this.CCONTROL);
                this.blockToLoop(7, this.schedule);
            }
            break;

        case 0x39:      //---------------- CCBR Change Conditionally, Block to 7000 Loop, Record
            if (!this.stopOverflow) {                   // check if branch should occur
                this.execTime += 3;
                this.SHIFTCONTROL = 0x04;               // for display only
            } else {
                this.execTime += 4;
                this.OFT.set(0);                    // reset overflow and do the branch
                this.SHIFT = 0x15;                      // for display only
                this.SHIFTCONTROL = 0x0F;               // for display only
                this.R.set(this.CCONTROL*0x1000000);       // save current control counter
                this.CCONTROL = this.CADDR%0x100 + 0x7000;  // set control to loop-7 address
                this.C.set((this.COP*0x10000 + this.CADDR)*0x10000 + this.CCONTROL);
                this.blockToLoop(7, this.schedule);
            }
            break;

        case 0x40:      //---------------- MTR  Magnetic Tape Read
            if (!this.magTape) {
                //this.schedule();
            } else {
                this.selectedUnit = (this.CEXTRA >>> 4) & 0x0F;
                d = (this.CEXTRA >>> 8) & 0xFF;         // number of blocks
                this.togMT3P = 1;
                this.togMT1BV4 = d & 0x01;              // select initial loop buffer
                this.togMT1BV5 = 1-this.togMT1BV4;
                this.execTime -= performance.now()*B220Processor.wordsPerMilli; // mark time during I/O
                if (this.magTape.read(this.selectedUnit, d, this.boundMagTapeReceiveBlock)) {
                    this.OFT.set(1);                // control or tape unit busy/not-ready
                    this.togMT3P = this.togMT1BV4 = this.togMT1BV5 = 0;
                    //this.schedule();
                }
            }
            break;

        // 0x41:        //---------------- (no op)

        case 0x42:      //---------------- MTS  Magnetic Tape Search
            if (this.magTape) {
                this.selectedUnit = (this.CEXTRA >>> 4) & 0x0F;
                d = (this.CEXTRA >>> 8) & 0xFF;         // lane number
                if (this.magTape.search(this.selectedUnit, d, this.CADDR)) {
                    this.OFT.set(1);                // control or tape unit busy/not-ready
                }
            }
            //this.schedule();
            break;

        // 0x43:        //---------------- (no op)

        case 0x44:      //---------------- CDR  Card Read (Cardatron)
            this.D.set(0);
            if (!this.cardatron) {
                //this.schedule();
            } else {
                this.tog3IO = 1;
                this.kDigit = (this.CEXTRA >>> 8) & 0x0F;
                this.selectedUnit = (this.CEXTRA >>> 4) & 0x07;
                this.SHIFT = 0x08;                      // prepare to receive 11 digits
                this.execTime -= performance.now()*B220Processor.wordsPerMilli; // mark time during I/O
                this.cardatron.inputInitiate(this.selectedUnit, this.kDigit, this.boundCardatronReceiveWord);
            }
            break;

        case 0x45:      //---------------- CDRI Card Read Interrogate
            this.selectedUnit = (this.CEXTRA >>> 4) & 0x07;
            if (this.cardatron && this.cardatron.inputReadyInterrogate(this.selectedUnit)) {
                this.R.set(this.CCONTROL*0x1000000);
                this.setTimingToggle(0);                // stay in Execute
                this.OFT.set(1);                    // set overflow
                this.COP = 0x28;                        // make into a CC
                this.C.set((this.COP*0x10000 + this.CADDR)*0x10000 + this.CCONTROL);
            }
            //this.schedule();
            break;

        // 0x46-0x47:   //---------------- (no op)

        case 0x48:      //---------------- CDRF Card Read Format
            if (!this.cardatron) {
                //this.schedule();
            } else {
                this.tog3IO = 1;
                this.kDigit = (this.CEXTRA >>> 8) & 0x0F;
                this.selectedUnit = (this.CEXTRA >>> 4) & 0x07;
                this.SHIFT = 0x19;                      // start at beginning of a word
                this.execTime -= performance.now()*B220Processor.wordsPerMilli; // mark time during I/O
                this.cardatron.inputFormatInitiate(this.selectedUnit, this.kDigit,
                        this.boundCardatronOutputWord, this.boundCardatronOutputFinished);
            }
            break;

        // 0x49:        //---------------- (no op)

        case 0x50:      //---------------- MTW  Magnetic Tape Write
            if (!this.magTape) {
                //this.schedule();
            } else {
                this.selectedUnit = (this.CEXTRA >>> 4) & 0x0F;
                d = (this.CEXTRA >>> 8) & 0xFF;         // number of blocks
                this.togMT3P = 1;
                this.togMT1BV4 = d & 0x01;              // select initial loop buffer
                this.togMT1BV5 = 1-this.togMT1BV4;
                this.execTime -= performance.now()*B220Processor.wordsPerMilli; // mark time during I/O
                if (this.magTape.write(this.selectedUnit, d, this.boundMagTapeInitiateSend)) {
                    this.OFT.set(1);                // control or tape unit busy/not-ready
                    this.togMT3P = this.togMT1BV4 = this.togMT1BV5 = 0;
                    //this.schedule();
                }
            }
            break;

        // 0x51:        //---------------- (no op)

        case 0x52:      //---------------- MTRW Magnetic Tape Rewind
            if (this.magTape) {
                this.selectedUnit = (this.CEXTRA >>> 4) & 0x0F;
                if (this.magTape.rewind(this.selectedUnit)) {
                    this.OFT.set(1);                // control or tape unit busy/not-ready
                }
            }
            break;

        // 0x53:        //---------------- (no op)

        case 0x54:      //---------------- CDW  Card Write (Cardatron)
            if (!this.cardatron) {
                //this.schedule();
            } else {
                this.tog3IO = 1;
                this.kDigit = (this.CEXTRA >>> 8) & 0x0F;
                this.selectedUnit = (this.CEXTRA >>> 4) & 0x07;
                this.SHIFT = 0x19;                      // start at beginning of a word
                this.execTime -= performance.now()*B220Processor.wordsPerMilli; // mark time during I/O
                this.cardatron.outputInitiate(this.selectedUnit, this.kDigit, (this.CEXTRA >>> 12) & 0x0F,
                        this.boundCardatronOutputWord, this.boundCardatronOutputFinished);
            }
            break;

        case 0x55:      //---------------- CDWI Card Write Interrogate
            this.selectedUnit = (this.CEXTRA >>> 4) & 0x07;
            if (this.cardatron && this.cardatron.outputReadyInterrogate(this.selectedUnit)) {
                this.R.set(this.CCONTROL*0x1000000);
                this.setTimingToggle(0);                // stay in Execute
                this.OFT.set(1);                    // set overflow
                this.COP = 0x28;                        // make into a CC
                this.C.set((this.COP*0x10000 + this.CADDR)*0x10000 + this.CCONTROL);
            }
            break;

        // 0x56-0x57:   //---------------- (no op)

        case 0x58:      //---------------- CDWF Card Write Format
            if (!this.cardatron) {
                //this.schedule();
            } else {
                this.tog3IO = 1;
                this.kDigit = (this.CEXTRA >>> 8) & 0x0F;
                this.selectedUnit = (this.CEXTRA >>> 4) & 0x07;
                this.SHIFT = 0x19;                      // start at beginning of a word
                this.execTime -= performance.now()*B220Processor.wordsPerMilli; // mark time during I/O
                this.cardatron.outputFormatInitiate(this.selectedUnit, this.kDigit,
                        this.boundCardatronOutputWord, this.boundCardatronOutputFinished);
            }
            break;

        // 0x59:        //---------------- (no op)

        default:        //---------------- (unimplemented instruction -- alarm)
            this.setProgramCheck(1);
            break;
        } // switch this.COP
    ***************************************************************************/
};


/***********************************************************************
*   Processor Run Control                                              *
***********************************************************************/

/**************************************/
B220Processor.prototype.run = function run() {
    /* Main execution control loop for the processor. Called from this.schedule()
    to initiate a time slice. Will continue fetch/execute phases until the time
    slice expires, a stop condition is detected, or AST (asynchronous toggle)
    is set indicating the processor has been suspended during an I/O. This
    routine effectively implements Operation Complete (O.C.) for the Fetch and
    Execute cycles, although it is more of a "ready for next operation" function,
    determining if there is a stop condition, or whether to do a Fetch or
    Execute cycle next. The fetch() and execute() methods exit back here, and
    in most cases we simply step to the next phase/instruction. In the case of
    asynchronous operation, however, we simply exit, and the I/O interface will
    call this.schedule() to restart execution again once memory transfers have
    completed */

    this.execLimit = this.execTime + B220Processor.timeSlice;

    do {
        switch (1) {
        case this.AST.value:            // doing I/O -- just exit
            this.execLimit = 0;
            break;

        case this.EXT.value:            // enter execute phase
            this.execute();
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
                        if (this.C.value%0x10 == this.S%0x10) {
                            this.RUT.set(0);
                        }
                    } else if (this.C.value%0x1000 == this.S%0x1000) {
                        this.RUT.set(0);
                    }
                }
            }
            break;

        default:                        // enter fetch phase
            if (this.SONSW) {                   // check for post-fetch S-to-P stop
                if (this.STOPSW) {              // must check before P is incremented in fetch()
                    if (this.SUNITSSW) {
                        if (this.P.value%0x10 == this.S%0x10) {
                            this.RUT.set(0);
                        }
                    } else if (this.C.value == this.S) {
                        this.RUT.set(0);
                    }
                }
            }

            this.fetch();
            if (this.SST.value) {
                this.stop();                    // single-stepping
            }
            break;
        }
    } while (this.execTime < this.execLimit);
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
    var runStamp;                       // real-world time at start of time slice, ms
    var stamp = performance.now();      // ending time for the delay and the run() call, ms

    this.scheduler = 0;

    // If run() has been called by a throttling delay, compute the delay stats.
    if (this.lastDelayStamp > 0) {
        delayTime = stamp - this.delayLastStamp;
        this.procSlack += delayTime;

        // Compute the exponential weighted average of scheduling delay.
        this.delayDeltaAvg = (delayTime - this.delayRequested)*B220Processor.delayAlpha +
                             this.delayDeltaAvg*B220Processor.delayAlpha1;
        this.procSlackAvg = delayTime*B220Processor.slackAlpha +
                            this.procSlackAvg*B220Processor.slackAlpha1;
    }

    // Accumulate internal processor run time if it's been idle due to I/O.
    while (this.procTime < 0) {
        this.procTime += stamp;
    }

    // Execute the time slice.
    runStamp = stamp;                   // starting clock time for time slice
    this.procTime -= this.execTime;     // prepare to accumulate internal processor time

    this.run();

    stamp = performance.now();
    this.procTime += this.execTime;     // accumulate internal processor time for the slice
    this.procRunAvg = (stamp - runStamp)*B220Processor.slackAlpha +
                      this.procRunAvg*B220Processor.slackAlpha1;

    // Determine what to do next.
    if (!this.RUT.value) {
        // Processor is stopped, just inhibit delay averaging on next call and exit.
        this.lastDelayStamp = 0;
    } else if (this.AST.value) {
        // Processor is still running, but idle during I/O.
        this.lastDelayStamp = 0;
        while (this.procTime >= 0) {
            this.procTime -= stamp;     // keep the internal processor timer running
        }
    } else {
        // The processor is still running, so schedule next time slice after a
        // throttling delay. delayTime is the number of milliseconds the
        // processor is running ahead of real-world time. Web browsers have a
        // certain minimum setTimeout() delay. If the delay is less than our
        // estimate of that minimum, setCallback() will yield to the event loop
        // but otherwise continue (real time should eventually catch up -- we
        // hope). If the delay is greater than the minimum, setCallback() will
        // reschedule us after that delay.

        delayTime = this.execTime - stamp;
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
                          !this.programCheckAlarm.value && !this.storageAlarm.value &&
                          !this.magneticTapeAlarm.value && !this.cardatronAlarm.value &&
                          !this.paperTapeAlarm.value && !this.highSpeedPrinterAlarm.value &&
                          !this.systemNotReady.value && !this.computerNotReady.value) {
        this.procStart = stamp;
        this.execTime = stamp;
        this.delayLastStamp = 0;
        this.delayRequested = 0;
        this.RUT.set(1);

        // Start the timers
        while (this.procTime >= 0) {
            this.procTime -= stamp;
        }
        while (this.runTimer >= 0) {
            this.runTimer -= stamp;
        }

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

        // Stop the timers
        while (this.procTime < 0) {
            this.procTime += stamp;
        }
        while (this.runTimer < 0) {
            this.runTimer += stamp;
        }

        if (this.scheduler) {
            clearCallback(this.scheduler);
            this.scheduler = 0;
        }
    }
};

/**************************************/
B220Processor.prototype.step = function step() {
    /* Single-steps the processor. This will execute the next Fetch or Execute
    phase only, then stop the processor */

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
    the next Execute phase, then stop */

    if (this.poweredOn) {
        this.RUT.set(0);
    }
};

/**************************************/
B220Processor.prototype.setPhase = function setPhase(phase) {
    /* Sets the processor phase to Fetch (0) or Execute (1) */

    if (this.poweredOn) {
        if (!this.RUT.value) {
            this.EXT.set(phase ? 1 : 0);
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
    /* Performs a Reset and Transfer operation, storing P in address 0000/04
    and C in 0000/64. Then branches to address 0001 */
    var w;

    if (this.poweredOn) {
        if (!this.RUT.value) {
            this.E.set(0x0000);
            w = this.readMemory();
            w += (this.C.value % 0x10000)*0x10000 + (this.P.value % 0x10000) -
                 w % 0x100000000;
            this.IB.set(w);
            this.writeMemory();
            this.P.set(0x0001);
            this.EXT.set(0);            // set to Fetch phase
            this.start();
        }
    }
};

/**************************************/
B220Processor.prototype.tcuClear = function tcuClear() {
    /* Clears the Tape Control Unit */

    if (this.poweredOn) {
        //?? TBD ??
    }
};

/**************************************/
B220Processor.prototype.inputSetup = function inputSetup(unitNr) {
    /* Called from the Cardatron Control Unit. If the Processor is stopped,
    loads a CDR (60) instruction into C for unit "unitNr" and sets Execute phase */

    if (this.poweredOn && !this.RUT.value) {
        this.CONTROL = unitNr*0x1000;   // recognize control words, no lockout
        this.COP = 0x60;                // CDR
        this.CADDR = 0;
        this.C.set((this.CCONTROL*0x100 + this.COP)*0x10000 + this.CADDR);
        this.EXT.set(1);
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
    }
};

/**************************************/
B220Processor.prototype.powerDown = function powerDown() {
    /* Powers down the system */

    if (this.poweredOn) {
        this.stop();
        this.clear();
        this.poweredOn = 0;

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

    // Simple counter speed test
    this.MM[   0] = 0x0000120002;       // ADD     2
    this.MM[   1] = 0x0000300000;       // BUN     0
    this.MM[   2] = 0x0000000001;       // CNST    1

    /*************************************************
    // Bootstrap to loop-based square-roots test
    this.MM[  10] = 0x0000360200        // BT6   200
    this.MM[  11] = 0x0000370220        // BT7   220
    this.MM[  12] = 0x0000206980        // CU   6980  branch to loop-6 entry point

    // Hello World
    this.MM[  20] = 0x0000070500;       // PTWF 0500  line feed
    this.MM[  21] = 0x0000640027;       // CAD    27
    this.MM[  22] = 0x0000030410;       // PTW  0410
    this.MM[  23] = 0x0000070800;       // PTWF 0800  space
    this.MM[  24] = 0x0000640028;       // CAD    28
    this.MM[  25] = 0x0000030410;       // PTW  0410
    this.MM[  26] = 0x0000089429;       // HALT 9429
    this.MM[  27] = 0x4845535356;       // LIT  "HELLO"
    this.MM[  28] = 0x6656595344;       // LIT  "WORLD"

    // Tom Sawyer's "Square Roots 100" (Babylonian or Newton's method):
    this.MM[ 100] = 0x640139;           // CAD   139
    this.MM[ 101] = 0x120138;           // ST    138
    this.MM[ 102] = 0x640139;           // CAD   139
    this.MM[ 103] = 0x130005;           // SR    5
    this.MM[ 104] = 0x610138;           // DIV   138
    this.MM[ 105] = 0x120137;           // ST    137
    this.MM[ 106] = 0x750138;           // SUB   138
    this.MM[ 107] = 0x120136;           // ST    136
    this.MM[ 108] = 0x660136;           // CADA  136
    this.MM[ 109] = 0x750135;           // SUB   135
    this.MM[ 110] = 0x730135;           // OSGD  135
    this.MM[ 111] = 0x280118;           // CC    118
    this.MM[ 112] = 0x640138;           // CAD   138
    this.MM[ 113] = 0x740137;           // ADD   137
    this.MM[ 114] = 0x130005;           // SR    5
    this.MM[ 115] = 0x610134;           // DIV   134
    this.MM[ 116] = 0x120138;           // ST    138
    this.MM[ 117] = 0x200102;           // CU    102
    this.MM[ 118] = 0x640139;           // CAD   139
    this.MM[ 119] = 0x030505;           // PTW   0505
    this.MM[ 120] = 0x640137;           // CAD   137
    this.MM[ 121] = 0x030810;           // PTW   0810
    this.MM[ 122] = 0x640139;           // CAD   139
    this.MM[ 123] = 0x740133;           // ADD   133
    this.MM[ 124] = 0x120139;           // ST    139
    this.MM[ 125] = 0x200102;           // CU    102
    this.MM[ 126] = 0;
    this.MM[ 127] = 0;
    this.MM[ 128] = 0;
    this.MM[ 129] = 0;
    this.MM[ 130] = 0;
    this.MM[ 131] = 0;
    this.MM[ 132] = 0;
    this.MM[ 133] = 0x100000;
    this.MM[ 134] = 0x200000;
    this.MM[ 135] = 0x10;
    this.MM[ 136] = 0;
    this.MM[ 137] = 0;
    this.MM[ 138] = 0;
    this.MM[ 139] = 0x200000;

    // "Square Roots 100" running from the loops with R cleared for division:
    // Block for the 6980 loop
    this.MM[ 200] = 0x0000647039;       // CAD  7039
    this.MM[ 201] = 0x0000127038;       // ST   7038
    this.MM[ 202] = 0x0000647039;       // CAD  7039
    this.MM[ 203] = 0x0000330000;       // CR
    this.MM[ 204] = 0x0000130005;       // SR   5
    this.MM[ 205] = 0x0000617038;       // DIV  7038
    this.MM[ 206] = 0x0000127037;       // ST   7037
    this.MM[ 207] = 0x0000757038;       // SUB  7038
    this.MM[ 208] = 0x0000127036;       // ST   7036
    this.MM[ 209] = 0x0000667036;       // CADA 7036
    this.MM[ 210] = 0x0000757035;       // SUB  7035
    this.MM[ 211] = 0x0000737035;       // OSGD 7035
    this.MM[ 212] = 0x0000287000;       // CC   7000
    this.MM[ 213] = 0x0000647038;       // CAD  7038
    this.MM[ 214] = 0x0000747037;       // ADD  7037
    this.MM[ 215] = 0x0000330000;       // CR
    this.MM[ 216] = 0x0000130005;       // SR   5
    this.MM[ 217] = 0x0000617034;       // DIV  7034
    this.MM[ 218] = 0x0000127038;       // ST   7038
    this.MM[ 219] = 0x0000206982;       // CU   6982
    // Block for the 7000 loop
    this.MM[ 220] = 0x0000647039;       // CAD  7039
    this.MM[ 221] = 0x0000030505;       // PTW  0505
    this.MM[ 222] = 0x0000647037;       // CAD  7037
    this.MM[ 223] = 0x0000030810;       // PTW  0810
    this.MM[ 224] = 0x0000647039;       // CAD  7039
    this.MM[ 225] = 0x0000747033;       // ADD  7033
    this.MM[ 226] = 0x0000127039;       // ST   7039
    this.MM[ 227] = 0x0000206982;       // CU   6982
    this.MM[ 228] = 0;
    this.MM[ 229] = 0;
    this.MM[ 230] = 0;
    this.MM[ 231] = 0;
    this.MM[ 232] = 0;
    this.MM[ 233] = 0x0000100000;
    this.MM[ 234] = 0x0000200000;
    this.MM[ 235] = 0x0000000010;
    this.MM[ 236] = 0;
    this.MM[ 237] = 0;
    this.MM[ 238] = 0;
    this.MM[ 239] = 0x0000200000;

    // "Square Roots 100" adapted for floating-point and relative precision:
    this.MM[ 300] = 0x0000640339;       // CAD   339    load initial argument
    this.MM[ 301] = 0x0000120338;       // ST    338    store as initial upper bound
    this.MM[ 302] = 0x0000640339;       // CAD   339    start of loop: load current argument
    this.MM[ 303] = 0x0000330000;       // CR           clear R
    this.MM[ 304] = 0x0000830338;       // FDIV  338    divide argument by upper bound
    this.MM[ 305] = 0x0000120337;       // ST    337    store as current result
    this.MM[ 306] = 0x0000830338;       // FDIV  338    ratio to upper bound
    this.MM[ 307] = 0x0000120336;       // ST    336    store as current precision
    this.MM[ 308] = 0x0000660335;       // CADA  335    load target precision
    this.MM[ 309] = 0x0000810336;       // FSU   336    subtract current precision
    this.MM[ 310] = 0x0000730335;       // OSGD  335    if current precision > target precision
    this.MM[ 311] = 0x0000280318;       // CC    318        we're done -- jump out to print
    this.MM[ 312] = 0x0000640338;       // CAD   338    load current upper bound
    this.MM[ 313] = 0x0000800337;       // FAD   337    add current result
    this.MM[ 314] = 0x0000330000;       // CR           clear R
    this.MM[ 315] = 0x0000830334;       // FDIV  334    divide by 2.0 to get new upper bound
    this.MM[ 316] = 0x0000120338;       // ST    338    store new upper bound
    this.MM[ 317] = 0x0000200302;       // CU    302    do another iteration
    this.MM[ 318] = 0x0001640339;       // CAD   339
    this.MM[ 319] = 0x0000030510;       // PTW   0510
    this.MM[ 320] = 0x0000640337;       // CAD   337
    this.MM[ 321] = 0x0000030810;       // PTW   0810
    this.MM[ 322] = 0x0000640339;       // CAD   339    load argument value
    this.MM[ 323] = 0x0000800333;       // FAD   333    add 1 to argument value
    this.MM[ 324] = 0x0000120339;       // ST    339
    this.MM[ 325] = 0x0000200301;       // CU    301    start sqrt for next argument value
    this.MM[ 326] = 0;
    this.MM[ 327] = 0;
    this.MM[ 328] = 0;
    this.MM[ 329] = 0;
    this.MM[ 330] = 0;
    this.MM[ 331] = 0;
    this.MM[ 332] = 0;
    this.MM[ 333] = 0x05110000000;      // 1.0 literal: argument increment
    this.MM[ 334] = 0x05120000000;      // 2.0 literal
    this.MM[ 335] = 0x05099999990;      // 0.99999990 literal: target precision
    this.MM[ 336] = 0;                  // current precision
    this.MM[ 337] = 0;                  // current sqrt result
    this.MM[ 338] = 0;                  // current upper bound on result
    this.MM[ 339] = 0x05120000000;      // 2.0 sqrt argument
    *************************************************/
};