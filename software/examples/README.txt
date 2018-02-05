Index of folder retro-220/software/examples:
Miscellaneous example programs for the retro-220 emulator.

Unless otherwise specified, all files are in standard Windows text
format, with carriage-return/line-feed delimiters.


List-Cards.card
    A simple assembly language program to list card images from
    Cardatron input unit 1 to Cardatron output unit 2. Assemble with
    software/tools/BAC-Assembler.html.

List-Cards.lst
    Assembly listing for List-Cards.card.

List-Cards-Load.card
    Loadable band-6 object deck for List-Cards.card.

Machine-Language-Loader.card
    Assembly language program to load object code in BALGOL Machine
    Language Instruction Card format (see Appendix F in
    http://bitsavers.org/pdf/burroughs/electrodata/220/220-21017_B220_BA
    LGOL_Mar63.pdf) to 220 memory. Assemble with software/tools/BAC-
    Assembler.html.

Machine-Language-Loader.lst
    Assembly listing from Machine-Language-Loader.card.

Machine-Language-Loader.Load.card
    Loadable band-6 object deck Machine-Language-Loader.card.

Memory-Clear-0000-4999.Load.card
    Loadable band-6 object deck for a program to clear 220 memory
    addresses 0000-4999 and then halt.

PRIME.TABLE.card
    Assembly language program to print a table of prime numbers.
    Assemble with software/tools/BAC-Assembler.html.

PRIME.TABLE.lst
    Assembly listing for PRIME.TABLE.lst, including sample output to the
    SPO, listing primes to 21,397.

PRIME.TABLE.Load.pt
    Loadable object code for the PRIME.TABLE.card program in retro-220
    paper tape image format.

WINTER.PI.card
    Assembly language program to calculate and print the first 800
    digits of Pi. Assemble with software/tools/BAC-Assembler.html. This
    program was ported to the 220 by Paul Kimpel (via Burroughs B5500
    Algol and the ElectroData/Burroughs 205) from a C program by Dik T.
    Winter of CWI in Amsterdam (see
    https://cs.uwaterloo.ca/~alopez-o/math-faq/mathtext/node12.html).

WINTER.PI.lst
    Assembly listing for WINTER.PI.card, including sample output to the
    SPO.

WINTER.PI.Code.lst
    Assembly listing for WINTER.PI.card, with the assembled code
    arranged for manual conversion to retro-220 paper-tape image format.

WINTER.PI.Load.card
    Loadable band-6 object deck for WINTER.PI.card.

WINTER.PI.Load.pt
    Loadable object code in retro-220 paper-tape image format for
    WINTER.PI.card.

WINTER-PI.Load-Inverse.pt
    Loadable object code in retro-220 paper-tape image inverse (sign
    last) format for WINTER.PI.card.

Paul Kimpel
January 2017