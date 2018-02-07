Index of folder retro-220/software/BALGOL/BALGOL-Examples:
Source, object, and compilation listings for example and test programs
used with the BAC-220 Burroughs Algebraic Compiler.

Each program consists of multiple files contained in a directory. The
following standard file name extensions and suffixes indicate the format
and purpose of each file:

    .card       80-column card image, usually for assembly language
                source code or data for the program. The retro-220
                emulator will internally truncate longer lines to 80
                characters and pad shorter lines out to a length of 80.

    .pt         paper-tape file in the format used by the retro-220
                emulator.

    .lst        printer output listing of assembly or program run.
                Lines may be preceded by a form-feed (ASCII hex 0C) to
                indicate a skip to top-of-page. Generally, files with a
                suffix of "-List.lst" are output from a compile and/or
                run of the program. "-Code-List.lst" is the same, but
                the compilation listing includes generated object code.

    .Load.card  80-column card image file containing loadable object
                code. Unless specified otherwise, these decks will be in
                self-loading 220 band-6 format for the Cardatron reader,
                and will require manual insertion of a card read
                instruction into the C register of the processor (e.g.,
                1000 60 0000 for input unit 1) to load the program.

Unless otherwise specified, all files are in standard Windows text
format, with carriage-return/line-feed delimiters.


777-Cards.card
    A small deck with three Cardatron "777" (ignore) cards that can be
    used to pad the end of a card deck.

Library-Test-1/
    BALGOL program to compute values from various library routines as a
    test of the compiler and library. The listings include output from
    runs of the program.

    The "-ROUND.lst" file has output from the program run under an
    experimental version of the retro-220 that attempted to do rounding
    for floating-point add/subtract to see what kind of difference that
    made. The 220 did not round floating-point add/subtract results.

Reference-Manual/
    The example BALGOL programs from Section 11 of the BAC-220 Burroughs
    Algebraic Compiler manual, revised edition, March 1963, Burroughs
    document 220-21017, available at:
    http://bitsavers.org/pdf/burroughs/electrodata/220/
    220-21017_B220_BALGOL_Mar63.pdf.

    Example-1/
        Program to approximate harmonic-boundary values using
        orthonormal functions; written by J. G. Herriot of Stanford
        University. The "-Data.card" file contains sample data for the
        program arbitrarily made up by Paul Kimpel. The listing files
        include the results from running the program.

        The "-Object.tape" file is the tape image of the object code for
        the program written to tape unit 1 by the compiler. This can be
        used to execute the program without recompiling or to punch a
        loadable object deck onto cards.

        The "-Typos.card" file represents the initial transcription of
        the source code. It contains several transcription errors, plus
        a few errors in the code as published in the manual. This
        version was retained to test the compiler's ability to recover
        from such errors.

        The "-ROUND.lst" file has output from the program run under an
        experimental version of the retro-220 that attempted to do
        rounding for floating-point add/subtract.

        B5500-EMODE/ contains source and listings of Algol programs as
        converted to run on the Burroughs B5500 (retro-b5500 emulator)
        and modern Unisys ClearPath MCP (E-mode) systems. These were
        used to compare the results generated from the BALGOL compiler.

    Example-2/
        Program for survey traverse calculations.

    Example-3/
        Program for reduction of a square matrix to tridiagonal form,
        using the method of Householder.

    Example-4/
        Program to solve a set of linear equations of the form Ay = B
        using Crout's method with interchanges; written by G. Forsythe
        of Stanford University.

U.Dayton-Program/
    Source for two short BALGOL programs submitted to Burroughs by the
    University of Dayton in 1963 to report a compiler issue. Includes a
    transcription of the letter describing the problem and transmitting
    the two programs.
    Found at CBI by Tom Sawyer and transcribed by Paul Kimpel.

    Note: the version of the compiler reconstructed by the retro-220
    project still exhibits this error.


Paul Kimpel
February 2018







