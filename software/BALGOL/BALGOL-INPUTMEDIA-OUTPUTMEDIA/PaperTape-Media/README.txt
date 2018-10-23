Index of folder retro-220/software/BALGOL/BALGOL-INPUTMEDIA-OUTPUTMEDIA/
PaperTape-Media:

Source and object files to implement a version of the BALGOL compiler
that supports paper-tape input and TTY/paper-tape output for both
compilation and run-time.

Unless otherwise specified, all files are in standard Windows text
format, with carriage-return/line-feed delimiters.


Hello-World-BALGOL.card
    Card-image source for a simple "Hello World" program used to test
    the paper-tape support for the compiler.

Hello-World-BALGOL.pt
    Paper-tape source for the same "Hello World" program. As required by
    the compiler, each source line contains 14 words, with trailing
    words of spaces as necessary to pad out to that length.

Hello-World-Code-List.lst
    Compilation listing of the paper-tape program above with the
    generated code and run-time output.

PT-Compiler.tape
    Loadable tape image of the compiler generated with paper-tape
    support. This tape should be loaded to a taped drive designated as
    unit 2.

PT-Compiler-Callout.pt
    Paper-tape callout program to boot the compiler from the tape image
    above. This program should be loaded on a paper-tape reader
    designated as unit 1.

PT-Generator-Callout.card
    Card deck to run the BALGOL Generator program and produce the
    loadable compiler tape image above. This deck includes the object
    code for the paper-tape versions of the compiler's INPUTMEDIA and
    OUTPUTMEDIA routines, plus the object decks for the complete
    standard BALGOL library. The standard REED and RITE routines of the
    library have been replaced by ones to use paper-tape input and TTY
    output at run-time. Note that a 220 configuration that includes the
    Cardatron is required in order to run the Generator.

PT-INPUTMEDIA.card
    Card-image source for the paper-tape version of the compiler's
    INPUTMEDIA routine. This routine reads 14-word (70 character)
    records of source code at compile time. It must be assembled using
    the BAC-Assembler with the object code output as a "Gen MEDIA Deck"
    and then inserted into the Generator Callout deck above.

PT-INPUTMEDIA.lst
    Assembly listing from the source file above.

PT-INPUTMEDIA-Object.card
    Card-image object code output from the assembly above in "Gen MEDIA
    Deck" format.

PT-OUTPUTMEDIA.card
    Card-image source for the paper-tape version of the compiler's
    OUTPUTMEDIA routine. This must be assembled using the BAC-Assembler
    with the object code output as a "Gen MEDIA Deck" and then inserted
    into the Generator Callout deck above.

PT-OUTPUTMEDIA.lst
    Assembly listing from the source file above.

PT-OUTPUTMEDIA-Object.card
    Card-image object code output from the assembly above in "Gen MEDIA
    Deck" format.

PT-REED.card
    Card-image source for the paper-tape version of the BALGOL library's
    REED routine. This reads 16-word (80 character) records of input
    data for the READ intrinsic at run time. It must be assembled using
    the BAC-Assembler with the object code output as a "BALGOL ML Deck"
    and then inserted into the Generator Callout deck above.

PT-REED.lst
    Assembly listing from the source file above.

PT-REED-Object.card
    Card-image object code output from the assembly above in "BALGOL ML
    Deck" format.

PT-RITE.card
    Card-image source for the paper-tape/TTY version of the BALGOL
    library's RITE routine. This writes records of output data for the
    WRITE intrinsic at run time. It must be assembled using the BAC-
    Assembler with the object code output as a "BALGOL ML Deck" and then
    inserted into the Generator Callout deck above.

PT-RITE.lst
    Assembly listing from the source file above.

PT-RITE-Object.card
    Card-image object code output from the assembly above in "BALGOL ML
    Deck" format.

A script to convert card-image files to the paper-tape image format
required by the retro-220 emulator can be found at /software/tools/
Xlate-Card-PT.wsf.

Additional paper-tape source file examples can be found in:

    \software\BALGOL\BALGOL-Examples\Simpsons-Rule\SIMPS.pt

    \software\BALGOL\BALGOL-Examples\Reference-Manual\
              Example-2\Example-2-Corrected.pt


Paul Kimpel
October 2018


