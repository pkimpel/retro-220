Index of folder retro-220/software/Diagnostics:
Diagnostic programs for the retro-220 emulator.


TR1101_TR1301/
    Files for the Burroughs TR1101 System Maintenance Test and TR1301
    Magnetic Tape Performance Test. These were obtained from an eBay
    sale in September 2020 by Al Kossow of bitsavers.org with financial
    assistance from Loren Wilton and Paul Kimpel. These are diagnostic
    programs on paper tape -- just the object code, with nothing but
    very sketchy notes for documentation.

    The original paper tape image files were converted to the format
    (.pt) required by the retro-220 emulator. Those converted files were
    then disassembled into an assembler-like listing by the software/
    tools/BAC-Disassembler.html program in this project.

    These programs are very difficult to understand and get running,
    although TR1101 has revealed some emulator bugs that have since been
    fixed. TR1101 mostly runs -- if you set its very obscure parameters
    properly -- but there are still problems in the magnetic tape and
    Cardatron areas. TR1301 is still in a largely unexplored state.

    See http://bitsavers.org/bits/Burroughs/B220/ for the original paper
    tape image files.

TR1202-TR1206/
    A collection of five Burroughs diagnostic programs:

        TR1202 Memory Test
                Runs about 6m40s on a 5000-word system. Halts with
                9999 00 aaaa in C, where aaaa is the memory size - 101.
        TR1203 Operations Test
                Runs 100 iterations in about 100s, printing the
                iteration counter at the end of each set of 100.
                Runs until you stop it.
        TR1204 Arithmetic Test
                Runs about 2m35s; halts with 9999 00 9999 in C.
        TR1205 Floating-Point Test
                Runs about 4m35s; halts with 9999 00 9999 in C.
        TR1206 Field Select Test
                Runs about 2m54s; halts with 9999 00 9999 in C.

    TR1202 requires the system memory size to be pre-stored in word 0000
    of the 220 memory. See Memory_Test_MemSize.pt for a loadable paper
    tape program that can be prefixed to the TR1202 tape to accomplish
    this. An alternative is to store the memory size using the console
    keyboard.

    The other programs require no special preparation. The .pt
    files for these tests are configured to load from paper tape reader
    #1. The times above assume the reader is set to the HI speed.

Mahon-Regression-Test.pt
    A consolidation of TR1203, TR1204, TR1205, and TR1206 into a single
    program that runs only one iteration of each of the five tests.
    Developed by Michael Mahon and included here with his permissions.
    Load from paper tape reader #1. It requires no other setup. In the
    retro-220 emulator, this test completes in about 95 seconds with the
    paper tape reader set to the HI speed.

Paul Kimpel
September 2021





