rem Generate BAC-Assembler card decks from BALGOL transcription files.
pushd ..\BALGOL
..\tools\BAC-Xscript-Reformatter.wsf /q BALGOL-Main.baca
..\tools\BAC-Xscript-Reformatter.wsf /q BALGOL-Overlay.baca
..\tools\BAC-Xscript-Reformatter.wsf /q BALGOL-Intrinsics\ACOS.baca
..\tools\BAC-Xscript-Reformatter.wsf /q BALGOL-Intrinsics\ASIN.baca
..\tools\BAC-Xscript-Reformatter.wsf /q BALGOL-Intrinsics\ATAN.baca
..\tools\BAC-Xscript-Reformatter.wsf /q BALGOL-Intrinsics\COS.baca
..\tools\BAC-Xscript-Reformatter.wsf /q BALGOL-Intrinsics\COSH.baca
..\tools\BAC-Xscript-Reformatter.wsf /q BALGOL-Intrinsics\ENTIR.baca
..\tools\BAC-Xscript-Reformatter.wsf /q BALGOL-Intrinsics\ERROR.baca
..\tools\BAC-Xscript-Reformatter.wsf /q BALGOL-Intrinsics\EXP.baca
..\tools\BAC-Xscript-Reformatter.wsf /q BALGOL-Intrinsics\FIX.baca
..\tools\BAC-Xscript-Reformatter.wsf /q BALGOL-Intrinsics\FLFL.baca
..\tools\BAC-Xscript-Reformatter.wsf /q BALGOL-Intrinsics\FLFX.baca
..\tools\BAC-Xscript-Reformatter.wsf /q BALGOL-Intrinsics\FLOAT.baca
..\tools\BAC-Xscript-Reformatter.wsf /q BALGOL-Intrinsics\FXFL.baca
..\tools\BAC-Xscript-Reformatter.wsf /q BALGOL-Intrinsics\FXFX.baca
..\tools\BAC-Xscript-Reformatter.wsf /q BALGOL-Intrinsics\LABEL.baca
..\tools\BAC-Xscript-Reformatter.wsf /q BALGOL-Intrinsics\LOG.baca
..\tools\BAC-Xscript-Reformatter.wsf /q BALGOL-Intrinsics\MONTR.baca
..\tools\BAC-Xscript-Reformatter.wsf /q BALGOL-Intrinsics\READ.baca
..\tools\BAC-Xscript-Reformatter.wsf /q BALGOL-Intrinsics\REED.baca
..\tools\BAC-Xscript-Reformatter.wsf /q BALGOL-Intrinsics\RITE.baca
..\tools\BAC-Xscript-Reformatter.wsf /q BALGOL-Intrinsics\ROMXX.baca
..\tools\BAC-Xscript-Reformatter.wsf /q BALGOL-Intrinsics\SIN.baca
..\tools\BAC-Xscript-Reformatter.wsf /q BALGOL-Intrinsics\SINH.baca
..\tools\BAC-Xscript-Reformatter.wsf /q BALGOL-Intrinsics\SQRT.baca
..\tools\BAC-Xscript-Reformatter.wsf /q BALGOL-Intrinsics\TAN.baca
..\tools\BAC-Xscript-Reformatter.wsf /q BALGOL-Intrinsics\TANH.baca
..\tools\BAC-Xscript-Reformatter.wsf /q BALGOL-Intrinsics\TRACE.baca
..\tools\BAC-Xscript-Reformatter.wsf /q BALGOL-Intrinsics\WRITE.baca
rem Finish BALGOL deck generation.
popd