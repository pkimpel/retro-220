Index of folder retro-220/software/SNAP-Assembler:
Source and object files for Michael Mahon's SNAP-1E assembler for the
Burroughs 220, written while he was a student at the California
Institute of Technology in the mid-1960s.

SNAP has a columnar assembly notation and was written for the paper-tape
and magnetic-tape 220 configuration at CalTech -- no punched cards. It
was also written for printed output to the Burroughs Whippet printer, an
early, high-speed electrostatic printer originally developed for the
U.S. military.

Michael has generously allowed me to offer his assembler as part of the
retro-220 project. See his web site at http://www.michaeljmahon.com/ for
the original assembler files and documentation, information on his 220
emulator written for the Apple //e (!), and a number of documents on the
220.

The paper-tape image files on Michael's web site are encoded for use by
his emulator and are incompatible with the retro-220 emulator's paper-
tape implementation. See /software/tools/Mahon-PT-Xlate.wsf in the
retro-220 project repository for a Windows VBScript utility that will
translate from his paper-tape format to the one used by retro-220.

The object tape for the assembler is designed to be loaded on paper-tape
reader 0 (i.e., 10). Source code, however, is read from paper-tape
reader 1. The assembler halts after loading to allow you to load the
source tape and change the reader's unit designate.

Assembled object code is written to paper-tape punch 1. The assembly
listing is output to the SPO, which at CalTech was the high-speed
Whippet printer. Miscellaneous assembly messages are output to teletype
printer 0 (10), which in retro-220 can be configured to be the same
device as the SPO. Magnetic tape unit 1 is used as a scratch tape. It
must have an "edited" (i.e., erased and not formatted) tape mounted.

Unless otherwise specified, all files are in standard Windows text
format, with carriage-return/line-feed delimiters.


SNAP1E.SRC-retro.pt
    Source code for the SNAP-1E assembler, written in itself, using the
    paper-tape image format required by the retro-220 emulator. This is
    not a particularly readable format, so see the listing below for a
    better presentation.

SNAP1E.OBJ-retro-pt.
    Loadable object code for the SNAP-1E assembler, in the paper-tape
    image format required by the retro-220 emulator. See the notes above
    and the assembler manual below for more information on running the
    assembler.

SNAP1E.Listing-retro.txt
    Assembly listing of the SNAP-1E assembler, as generated from the
    retro-220 emulator. Because of the I/O device configuration for the
    system at CalTech, it used a few different internal character codes
    than those for a standard 220. Thus, the listing needs to be viewed
    with the following substitutions in mind. Fortunately, except for
    "+", these were only used in comments.

        CalTech         retro-220
           =                #
           +                $
           (                ¤   (U0164, the "lozenge")
           )                ¤   (also lozenge: a quirk of Cardatron code 
                                    translation)

SNAP1E.Manual.pdf
    Manual for the assembler, OCR-ed by Michael from his original IBM
    1403 line-printer listing.

SIEVE.SRC-retro.pt
    Assembler source for a prime-number sieve written in SNAP-1E.

SIEVE.OBJ-retro.pt
    Loadable object code for the SIEVE program, in the paper-tape image
    format required by the retro-220 emulator. Load the object tape on
    paper-tape reader 0. This program writes its output to magnetic tape
    unit 1 in 100-word blocks. The tape unit must be loaded with an
    edited, unformatted tape.

SIEVE.Listing-retro.txt
    Assembler listing of the SIEVE program.

Paul Kimpel
January 2018



