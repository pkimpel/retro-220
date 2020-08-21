Index of folder retro-220/software/tools:
Scripts and utilities supporting the Burroughs 220 BALGOL Compiler
reconstruction effort.

Unless otherwise specified, all files are in standard Windows text
format, with carriage-return/line-feed delimiters.


220-Paper-Tape-Decoder.html
    HTML/Javascript utility to translate Al Kossow's binary paper-
    tape image files to the paper-tape image format used by the
    retro-220 emulator.

BAC-Assembler.html
    HTML/Javascript assembler for the assembly language dialect used
    with the BALGOL Main, Overlay, and library functions.

BAC-DeckGen.cmd
    Windows command-line script to generate card decks for BAC-Assembler
    from the transcribed *.baca files for the BALGOL compiler.

BAC-Disassembler.html
    HTML/Javascript utility to disassemble 220 object code from paper-
    tape image files (in the format used by the retro-220 emulator) to
    the assembly notation used by BAC-Assembler.html.

BAC-XScript-Reformatter.wsf
    Windows VBScript utility to extract source code from the BALGOL
    assembly listing transcriptions and reformat them into card decks
    for use by BAC-Assembler.html

BALGOL-Dumpanalyzer.html
    Script to read the text of a retro-220 memory dump taken while the
    BALGOL compiler is running and do a partial analysis of the
    compiler's tables.

GEN-Assembler.html
    HTML/Javascript assembler for the assembly language dialect used
    with the BALGOL Generator utility.

GEN-XScript-Reformatter.wsf
    Windows VBScript utility to extract source code from the Generator
    assembly listing transcription and reformat it into a card deck for
    use by GEN-Assembler.html.

Mahon-PT-Xlate.wsf
    Windows VBScript utility to translate the original paper tape files
    for Michael Mahon's SNAP-1E assembler for the 220 to the paper tape
    image format required by the retro-220 emulator.
    See /software/SNAP-Assembler for more on that assembler.

Xlate-Card-PT.wsf
    Windows VBScript utility to translate card image files to the paper
    tape image format required by the retro-220 emulator. An optional
    parameter specifies the number of words per paper-tape record. This
    defaults to 14 for input to the paper-tape version of the BALGOL
    compiler. It should be 16 for input to programs compiled by the
    paper-tape version of BALGOL.

Paul Kimpel
January 2018
    Original submission.
2018-06-10
    Add BALGOL-Dumpanalyzer.
2018-10-22
    Added Xlate-Card-PT.wsf.
2020-08-20
    Added 220-Paper-Tape-Decoder.html and BAC-Disassembler.html.
