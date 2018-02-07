Index of folder retro-220/software/examples:
Miscellaneous example programs for the retro-220 emulator.

Each program either consists of multiple files contained in a directory,
or exists as a standalone loadable machine code file. The following
standard file name extensions and suffixes indicate the format and
purpose of each file:

    .card       80-column card image, usually for assembly language
                source code or data for the program. The retro-220
                emulator will internally truncate longer lines to 80
                characters and pad shorter lines out to a length of 80.

    .pt         paper-tape file in the format used by the retro-220
                emulator.

    .lst        printer output listing of assembly or program run.
                Lines may be preceded by a form-feed (ASCII hex 0C) to
                indicate a skip to top-of-page.

    .Load.card  80-column card image file containing loadable object
                code. Unless specified otherwise, these decks will be in
                self-loading 220 band-6 format for the Cardatron reader,
                and will require manual insertion of a card read
                instruction into the C register of the processor (e.g.,
                1000 60 0000 for input unit 1) to load the program.

    .Load.pt    paper-tape image file containing loadable object code.
                Unless specified otherwise, these tapes will be self-
                loading and will require manual insertion of a paper-
                tape read instruction into the C register of the
                processor (e.g., 1000 04 0000 for reader 1) to load the
                program.

Unless otherwise specified, all files are in standard Windows text
format, with carriage-return/line-feed delimiters.


List-Cards/
    A simple assembly language program to list card images from
    Cardatron input unit 1 to Cardatron output unit 2.
    Assemble with software/tools/BAC-Assembler.html.

Machine-Language-Loader/
    Assembly language program to load an object code deck in BALGOL
    Machine Language Instruction Card format (see Appendix F in
    http://bitsavers.org/pdf/burroughs/electrodata/220/
    220-21017_B220_BALGOL_Mar63.pdf) to 220 memory.
    Assemble with software/tools/BAC-Assembler.html.

Memory-Clear-0000-4999.Load.card
    Loadable band-6 object deck for a program to clear 220 memory
    addresses 0000-4999 and then halt.

PRIME.TABLE/
    Assembly language program to print a table of prime numbers. Adapted
    from a program by Tom Sawyer for the ElectroData/Burroughs 205.
    Assemble with software/tools/BAC-Assembler.html.

    The listing shows sample output to the SPO, listing primes to
    21,397.

WINTER.PI/
    Assembly language program to calculate and print the first 800
    digits of Pi. This program was ported to the 220 by Paul Kimpel (via
    Burroughs B5500 Algol and the ElectroData/Burroughs 205) from a C
    program written by Dik T. Winter of CWI in Amsterdam (see
    https://cs.uwaterloo.ca/~alopez-o/math-faq/mathtext/node12.html).
    Assemble with software/tools/BAC-Assembler.html.

    The listing includes sample output to the SPO.

    WINTER.PI.Code.lst is an assembly listing with the assembled code
    arranged for manual conversion to retro-220 paper-tape image format.

    WINTER.PI.Load.pt has loadable object code in retro-220 paper-tape
    image format.

    WINTER-PI.Load-Inverse.pt has loadable object code in retro-220
    paper-tape image inverse (sign last) format.

Paul Kimpel
February 2017
