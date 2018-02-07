Index of folder retro-220/software/BALGOL:
Source, object, and assembly listings for the Burroughs Algebraic
Compiler, an implementation of Algol-58 for the Burroughs 220, as
prepared for the retro-220 emulator.

Unless otherwise specified, all files are in standard Windows text
format, with carriage-return/line-feed delimiters.


BAC-220-Compiler.tape
    Loadable BAC-220 Compiler tape produced by the Generator. This
    contains the compiler and library, configured according to the
    statements in BAC-220-Generator-Callout.card

BAC-220-Compiler-Callout.card
    Bootstrap card deck to load the compiler from its tape and initiate
    compilation. Source cards should follow this deck.

BAC-220-Generator-tape.
    Loadable BAC-220 Generator tape. Use this to generate new versions
    of the Compiler tape.

BAC-220-Generator-Bootstrap.card
    Bootstrap card deck and configuration statements to generate an
    initial compiler tape and standard library. See BALGOL-Build-Notes
    for how this is used.

BAC-220-Generator-Callout.card
    Bootstrap card deck and typical configuration statements for
    generating a standard compiler tape from BAC-220-Generator.tape.

BAC-220-Object-Tape-Callout.card
    Loadable object deck for a utility that will load a program from an
    object tape (unit #1) produced by the BALGOL compiler.

BALGOL-Build-Notes.txt
    Notes for bootstrapping the BALGOL Generator and Compiler programs
    from source code and generating loadable tapes for each one.

BALGOL-Generator/
    Compiler generator program to build versions of the BAC-220 compiler
    and library customized to a site's configuration and requirements.
    Note that this program is written using a different assembly
    language than the other BALGOL components below.

    See Appendix A, F, and G in
    http://bitsavers.org/pdf/burroughs/electrodata/220/
    220-21017_B220_BALGOL_Mar63.pdf.

    .bacg
        Assembly listing of the BALGOL compiler-generator program,
        transcribed by Paul Kimpel from:
        http://archive.computerhistory.org/resources/text/
        Knuth_Don_X4100/PDF_index/k-1-pdf/k-1-u2196-
        balgol220compiler.pdf.

    .card
        Card-image assembler source deck extracted from the .bacg file
        for input to the assembler.
        Assemble with software/tools/GEN-Assembler.

    -List.lst
        Assembly listing of .card produced by the GEN-Assembler. This
        output was compared back to the .bacg file to verify the
        transcription of the Generator.

    -Object.tape
        Object code tape image for the Generator produced by GEN-
        Assembler from the .card file. See BALGOL-Build-Notes.txt for
        how this is used.

    -PoolSet.js
        JSON text file containing literal-pool pre-load values for use
        by the GEN-Assembler in assembling the Generator. Pre-loading
        the literal pool assures that the same addresses will be
        assigned by the assembler to literal values and strings as were
        originally present in the transcribed .bacg file.

BALGOL-Main/
    Main program for the BAC-220 compiler. This performs the basic one-
    pass compilation of the source program, but does not link library
    and external routines or generate run-time overlays.

    .baca
        Assembly listing of the BALGOL compiler main module, transcribed
        by Paul Kimpel from:
        http://archive.computerhistory.org/resources/text/
        Knuth_Don_X4100/ PDF_index/k-1-pdf/k-1-u2196-
        balgol220compiler.pdf.
        This transcription reflects the few corrections hand-coded on
        the listing.

    .card
        Card-image assembler source deck extracted from the .baca file
        for input to the assembler.
        Assemble with software/tools/BAC-Assembler.

    .lst
        Assembly listing of .card produced by the BAC-Assembler. This
        output was compared back to the .baca file to partially verify
        the transcription of the compiler.

    .card
        Object code deck in BALGOL Machine Language format produced by
        BAC-Assembler from .card. See BALGOL-Build-Notes.txt for how
        this is used.

    -PoolSet.js
        JSON text file containing literal-pool pre-load values for use
        by the BAC-Assembler script in assembling the program.

BALGOL-Overlay/
    Overlay program for the BAC-220 compiler. This program is loaded by
    the Main program at the end of compiling the source deck. It merges
    and links any code for library routines and external machine-
    language programs into the object code, builds code segments and
    constructs the program's overlay mechanism if called for, and
    generates additional code for symbolic DUMP statements.

    .baca
        Assembly listing of the BALGOL compiler overlay module,
        transcribed by Paul Kimpel from:
        http://archive.computerhistory.org/resources/text/
        Knuth_Don_X4100/PDF_index/k-1-pdf/k-1-u2196-
        balgol220compiler.pdf.
        This transcription reflects any corrections hand-coded on the
        listing.

    .card
        Card-image assembler source deck extracted from the .baca file
        for input to the assembler.
        Assemble with software/tools/BAC-Assembler.

    .lst
        Assembly listing of .card produced by the BAC-Assembler. This
        output was compared back to the .baca file to partially verify
        the transcription of the compiler.

    .card
        Object code deck in BALGOL Machine Language format produced by
        BAC-Assembler from .card. See BALGOL-Build-Notes.txt for how
        this is used.

    -PoolSet.js
        JSON text file containing literal-pool pre-load values for use
        by the BAC-Assembler script in assembling the program.

BALGOL-Library/
    Source files and object decks for the BALGOL standard function
    library, transcribed by Paul Kimpel from:
    http://archive.computerhistory.org/resources/text/Knuth_Don_X4100/
    PDF_index/k-1-pdf/k-1-u2196-balgol220compiler.pdf.
    These transcriptions reflect some notations and corrections hand-
    coded on the listings.

    Files for library routine XXXXX are named as follows:

    XXXXX.baca
        Transcribed assembly listing.
    XXXXX.card
        Card image deck extracted from the .baca file. Assemble with
        software/tools/BAC-Assembler.
    XXXXX-List.lst
        Listing generated by BAC-Assembler.
    XXXXX-Object.card
        Object deck generated by BAC-Assembler in BALGOL Machine
        Language format.

    This folder also contains PUNCH-LIBRARY.card, the complete set of
    object decks for the compiler's standard library routines as
    produced by the Generator program PUNCH LIBRARY... statement.

BALGOL-Examples/
    Source code and listings for sample BALGOL programs. See the README
    file in the directory for details.

Paul Kimpel
February 2018



