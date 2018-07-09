Index of folder retro-220/software/BALGOL:
Source, object, and assembly listings for the Burroughs Algebraic
Compiler, an implementation of Algol-58 for the Burroughs 220, as
prepared for the retro-220 emulator.

Unless otherwise specified, all files are in standard Windows text
format, with carriage-return/line-feed delimiters.

Loadable object decks can be executed by loading them into Card Reader
1, clicking Start on the reader, Clearing the processor on the Control
Console, entering 1000 60 0000 into the C register, setting the Execute
Toggle, and finally clicking Start on the Control Console.


BAC-220-Compiled-Object-Dump-Callout.card
    Loadable object deck for a utility that will dump a compiled program
    to cards from an object tape (unit 1) produced by the BAC-220
    Compiler. Requires the Compiler tape on unit 2. See Appendix B of
    the Compiler reference manual.

BAC-220-Compiled-Object-Program-Callout.card
    Loadable object deck for a utility that will load and run a compiled
    program from an object tape (unit 1) produced by the BAC-220
    compiler. See Appendix B of the Compiler reference manual.

BAC-220-Compiled-Object-Program-Loader.card
    Loader deck for card decks punched by the BAC-220-Compiled-Object-
    Dump-Callout.card program. This deck consists of the BAC-220-
    Compiled-Object-Program-Loader-Bootstrap.card program, followed by
    the program loader deck that is punched by the BAC-220-Compiled-
    Object-Dump-Callout.card program when Program Control Switch 4 is
    on, followed by the required blank card at the end.

    To use, load this deck into card reader 1. Then load the object deck
    for the compiled BALGOL program you wish to run, followed by its
    data cards, if any, then start the processor as described above.

BAC-220-Compiled-Object-Program-Loader-Bootstrap.card
    Loadable bootstrap deck for the object program loader that is
    punched by the BAC-220-Compiled-Object-Dump-Callout.card program
    when Program Control Switch 4 is on. This bootstrap expects the
    object deck for the program loader to follow it immediately.

BAC-220-Compiled-Object-Program-Loader-Callout.card
    Loadable bootstrap deck for the object program loader. This will
    load the loader from the compiler tape to memory, but will then halt
    with 0757 00 7250 in the C register. You must manually execute the
    loader. This bootstrap deck is specifically intended for use when
    loading compiled object programs from paper tape.

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

BALGOL-Build-Notes.txt
    Notes for bootstrapping the BALGOL Generator and Compiler programs
    from source code and generating loadable tapes for each one.

BALGOL-Generator/
    Compiler generator program to build versions of the BAC-220 compiler
    and library customized to a site's configuration and requirements.
    Note that this program is written using a different assembly
    language than the other BALGOL components below.

    See Appendix A, F, and G in the Compiler reference manual at:
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
        Assembly listing of .card produced by the GEN-Assembler. This
        output was compared back to the .bacg file to verify the
        transcription of the Generator.

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
        originally present in the transcribed .bacg file.

    -SPO-Output.txt
        Sample SPO output from the Generator run that builds the
        standard library and initial Compiler tape.

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

BALGOL-Examples/
    Source code and listings for sample BALGOL programs. See the README
    file in the directory for details.

Paul Kimpel
July 2018

