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


BLACKJACK/
    A program that plays Blackjack on the 220, with input from the
    console keyboard and output to the SPO. This was transcribed from
    "SAMPLE PROGRAM 2" in Appendix D of the "Burroughs 220 Assembler-
    Compiler" manual, Bulletin 5024, April 1960. Assemble with the BAC-
    Assembler. This manual was discovered at CBI:

        Burroughs Corporation Records, Product Literature (CBI 90),
        Charles Babbage Institute, University of Minnesota, Minneapolis.
        https://archives.lib.umn.edu/repositories/3/resources/186.
        Series 74, box 5, folder 17.

    Entry point to the program is the label BLKJK at address 0112. You
    must mount and make ready a pre-formatted magnetic tape with 100-
    word blocks on drive 1. The tape is not read or written -- instead
    the timing of tape positioning commands is used to generate random
    numbers.

    Appendix D had this description of the program:

        This program deals the card game "Blackjack" for dealer and one
        player. The ordinary rules are followed; i.e., if the dealer has
        16 or less, he is dealt another card, and if 17 or more, the
        hand is over. All communication is through the Supervisory
        Printer and the console keyboard.

        Before each hand, the player is given an opportunity to enter
        the amount he wishes to stake. At the end of each hand, the
        score is printed on the Supervisory Printer, followed by the
        amount due the player.

        The player is dealt two cards, shown on the Supervisory Printer,
        then questioned as to whether he desires another card. If he
        does, a zero is entered on the keyboard; if not, any other
        number is entered. The player may continue to draw cards, so
        long as his total does not exceed 21, or may stay at any point.
        The program then looks at the dealer's hand, and takes another
        card or not, depending upon the point score indicated above.

        When the deck is exhausted, it is shuffled; for this purpose, a
        pre-blocked tape must be mounted on unit 1.

        COMMENTS. An alphabetic lateral is shown between two dollar ($)
        signs. (See lines 0.14.02.0 through 0.14.06.0.)

        The DITTO command is used in this program, and a nested DITTO is
        used. (See location counter 0270 and following.)

    Note that the BAC-Assembler does not presently support the DITTO
    pseudo-operator, so these were commented out and the duplicate
    source lines were inserted in the deck manually.

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
    https://cs.uwaterloo.ca/~alopez-o/math-faq/mathtext/node12.html
    and https://crypto.stanford.edu/pbc/notes/pi/code.html).
    Assemble with software/tools/BAC-Assembler.html.

    The listing includes sample output to the SPO. The program takes
    about 40 minutes to run to completion.

    WINTER.PI.Code.lst is an assembly listing with the assembled code
    arranged for manual conversion to retro-220 paper-tape image format.

    WINTER.PI.Load.pt has loadable object code in retro-220 paper-tape
    image format.

    WINTER-PI.Load-Inverse.pt has loadable object code in retro-220
    paper-tape image inverse (sign last) format.

Paul Kimpel
July 2020

