Index of folder retro-220/software/BALGOL:
Source, object, and assembly listings for the Burroughs Algebraic
Compiler, an implementation of Algol-58 for the Burroughs 220, as
prepared for the retro-220 emulator.

Unless otherwise specified, all files are in standard Windows text
format, with carriage-return/line-feed delimiters.

Loadable object decks can be executed by loading them into card reader
unit 1, clicking START on the reader, clearing the processor on the
Control Console, entering 1000 60 0000 into the C register, setting the
Execute Toggle, and finally clicking START on the Control Console.


BAC-220-Object-Dump-Callout.card
    Loadable object deck for a utility that will dump a compiled program
    to either cards or paper tape from an object tape (on magnetic tape
    unit 1) produced by the BAC-220 Compiler. Requires the compiler tape
    on unit 2. Program Control Switches 3 and 4 are used to control the
    form of output. See Appendix B of the compiler reference manual.

BAC-220-Object-Program-Callout.card
    Loadable object deck for a utility that will load and run a compiled
    program from an object tape (on magnetic tape unit 1) produced by
    the BAC-220 compiler. Follow this deck with any data cards for the
    program. See Appendix B of the Compiler reference manual.

BAC-220-Object-Program-Card-Loader.card
    Loader deck for object card decks punched by the BAC-220-
    Object-Dump-Callout.card program. This deck consists of the BAC-220-
    Compiled-Object-Program-Loader-Bootstrap.card program below,
    followed by the Program Loader deck that is punched by the BAC-220-
    Compiled- Object-Dump-Callout.card program when Program Control
    Switch 4 is on, followed by the required "blank" card at the end.

    To use, load this deck into card reader 1. Then load the object deck
    for the compiled BALGOL program you wish to run, followed by its
    data cards, if any, then start the processor as described above.

BAC-220-Object-Program-Loader-Bootstrap.card
    Loadable bootstrap deck for the Object Program Loader that is
    punched by the BAC-220-Object-Dump-Callout.card program
    when Program Control Switch 4 is on. This bootstrap expects the
    object deck for the Program Loader to follow it immediately. This
    deck has already been inserted into BAC-220-Object-Program-
    Card-Loader.card above.

BAC-220-Object-Program-Card-Loader-Callout.card
    Loadable bootstrap deck for the Object Program Loader to load a
    program from cards. Follow this deck with the object deck for the
    compiled program and any data cards for the program. This callout
    will load the loader from the compiler tape on magnetic tape unit 2
    to memory, which will then load the object deck to memory and
    execute it.

BAC-220-Object-Program-PaperTape-Loader-Callout.card
    Loadable bootstrap deck for the Object Program Loader to load a
    program from paper tape. Follow this deck with any data cards for
    the program. This callout will load the loader from the compiler
    tape on magnetic tape unit 2 to memory, which will then load the
    object tape from paper tape unit 1 to memory and execute it.

BAC-220-Compiler.tape
    Loadable BAC-220 Compiler tape produced by the BAC-220-Generator-
    Callout.card deck below. This contains the standard compiler and
    library, configured according to the defaults in the Generator
    program. See Appendix A in the compiler manual.

BAC-220-Compiler-10K.tape
    Loadable BAC-220 Compiler tape produced by the Generator. This
    contains the standard compiler and library, but is configured for a
    220 system with 10,000 words of memory.

BAC-220-Compiler-Callout.card
    Bootstrap card deck to load the compiler from its tape and initiate
    compilation. Source and data cards should follow this deck. See
    Appendix B of the Compiler reference manual.

BAC-220-Generator-tape.
    Loadable BAC-220 Generator tape. Use this to generate new versions
    of the Compiler tape. See Appendix A of the Compiler reference
    manual.

BAC-220-Generator-Bootstrap.card
    Bootstrap card deck and configuration statements to generate an
    initial compiler tape and standard library. See BALGOL-Build-Notes
    for how this is used.

BAC-220-Generator-Callout.card
    Bootstrap card deck and configuration statements for
    generating a compiler tape with a default configuration from the
    BAC-220-Generator.tape.

BAC-220-Generator-Callout-10K.card
    Bootstrap card deck and configuration statements for
    generating the BAC-220-Compiler-10K.tape file above.

BAC-220-Loader-Blank-Card.card
    A "blank" card containing a "6" in column 1. This can be used in
    places where the Object Program Loader requires a blank card before
    the object program deck or the data deck, depending upon the way the
    program is being loaded.

BALGOL-Build-Notes.txt
    Notes for bootstrapping the BALGOL Generator and Compiler programs
    from source code and generating loadable tapes for each one. A
    somewhat reformatted version of these notes is in the
    "BuildingBALGOL" wiki page.

BALGOL-Generator/
    Compiler generator program to build versions of the BAC-220 compiler
    and library customized to a site's configuration and requirements.
    Note that this program is written using a different assembly
    language than the other BALGOL components below.

    See Appendix A, F, and G in the Compiler reference manual at:
    http://bitsavers.org/pdf/burroughs/electrodata/220/
    220-21017_B220_BALGOL_Mar63.pdf.

    .card
        Current card-image assembler source deck for the Generator
        program. This contains corrections to the original Generator
        program transcribed from Prof. Knuth's listing (see the BALGOL-
        Generator--ORIGINAL/ directory below).
        Assemble with software/tools/GEN-Assembler.

    -Fixup-1.card
        Source of a program to adjust blocks in the initial Generator
        tape created from the assembled object tapes. Assemble with GEN-
        Assembler. See BALGOL-Build-Notes.txt for details.

    -Fixup-1-Load.card
        Loadable band-6 object deck to execute the -Fixup-1 program.

    -Fixup-2.card
         Source of a program to copy the completed library tables and
         routines from the initially-generated Compiler tape to the
         Generator tape . Assemble with GEN-Assembler.
         See BALGOL-Build-Notes.txt for details.

    -Fixup-2-Load.card
        Loadable band-6 object deck to execute the -Fixup-2 program.

    -List.lst
        Current assembly listing of .card above produced by the GEN-
        Assembler.

    -Object.tape
        Object code tape image for the Generator produced by GEN-
        Assembler from the .card file. See BALGOL-Build-Notes.txt for
        how this is used.

    -Object-Store.card
        Loadable band-6 object deck run under the emulator to load the
        BALGOL-Generator-Object.tape image from to memory and then
        branch to the Generator's object store routine at address 0001.
        See BALGOL-Build-Notes.txt for details.

    -PoolSet.js
        JSON text file containing literal-pool pre-load values for use
        by the GEN-Assembler in assembling the Generator. Pre-loading
        the literal pool assures that the same addresses will be
        assigned by the assembler to literal values and strings as were
        originally present in the transcribed .bacg file. Note that if
        the Generator source is modified so that symbols used in literal
        expressions [e.g., =(IA+1)=] are assigned different addresses,
        the corresponding pool values may need to be updated in this
        file to match the new values of the literal expressions.

    -SPO-Output.txt
        Sample SPO output from the Generator run that builds the
        standard library and initial Compiler tape.

    BALGOL-Generator--ORIGINAL/
        This directory holds the files from the original transcription
        of the Generator program:

        BALGOL-Generator.bacg
            Assembly listing of the BALGOL compiler-generator program,
            transcribed by Paul Kimpel from:
            http://archive.computerhistory.org/resources/text/
            Knuth_Don_X4100/PDF_index/k-1-pdf/k-1-u2196-
            balgol220compiler.pdf.

        BALGOL-Generator.card
            Original card-image assembler source deck extracted from the
            .bacg file for input to the GEN-Assembler. This file
            represents the source for the Generator as it was
            transcribed.

        BALGOL-Generator-List.lst
            Assembly listing of the .card file above produced by GEN-
            Assembler. Pass 2 of this output was compared back to the
            .bacg file to verify the transcription of the Generator.

BALGOL-Main/
    Main program for the BAC-220 compiler. This performs the basic one-
    pass compilation of the source program, but does not link library
    and external routines or generate run-time overlays.

    .baca
        Assembly listing of the BALGOL compiler main module, transcribed
        by Paul Kimpel from:
        http://archive.computerhistory.org/resources/text/
        Knuth_Don_X4100/PDF_index/k-1-pdf/k-1-u2196-
        balgol220compiler.pdf.
        This transcription reflects the few corrections hand-coded on
        the listing.

    .card
        Card-image assembler source deck extracted from the .baca file
        for input to the assembler.
        Assemble with software/tools/BAC-Assembler.

    -List.lst
        Assembly listing of .card produced by the BAC-Assembler. This
        output was compared back to the .baca file to partially verify
        the transcription of the compiler.

    -Object.tape
        Object code tape image for the Main program produced by BAC-
        Assembler from the .card file. See BALGOL-Build-Notes.txt for
        how this is used.

    -Object-Store.card
        Loadable band-6 object deck for a program to load the -
        Object.tape to memory and then branch to the Main program's
        store routine at address 0001. See BALGOL-Build-Notes.txt for
        how this is used.

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

    -List.lst
        Assembly listing of .card produced by the BAC-Assembler. This
        output was compared back to the .baca file to partially verify
        the transcription of the compiler.

    -Object.tape
        Object code tape image for the Overlay produced by BAC-Assembler
        from the .card file. See BALGOL-Build-Notes.txt for how this is
        used.

    -Object-Store.card
        Loadable band-6 object deck run under the emulator to load the
        BALGOL-Overlay-Object.tape image from to memory and then branch
        to the Overlay program's object store routine at address 4000.
        See BALGOL-Build-Notes.txt for details.

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

BALGOL-INPUTMEDIA-OUTPUTMEDIA/
    Notes and object decks for alternate input/output routines for the
    Compiler and Library. These are used to configure the compiler and
    run-time to use different types of peripheral devices, e.g., paper
    tape. See the README file in the directory for details.

BALGOL-Examples/
    Source code and listings for sample BALGOL programs. See the README
    file in the directory for details.

Paul Kimpel
October 2018


