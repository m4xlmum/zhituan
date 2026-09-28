; 探针替身：${isUpdated}。
;
; 真实构建里它由 NsisTarget 注入到生成脚本里（判据是命令行上的 --updated）：
;
;   out/targets/nsis/nsisScriptGenerator.js:29-36
;     !macro _isUpdated _a _b _t _f
;       ${StdUtils.TestParameter} $R9 "updated"
;       StrCmp "$R9" "true" `${_t}` `${_f}`
;     !macroend
;     !define isUpdated `"" isUpdated ""`
;
; 探针里不照抄那两行：StdUtils 插件在探针的编译环境里未必就位，而探针要的是
; 「恒定成立」而不是「看命令行」。
;
; **形状必须一致，这一点踩过。** 写成 `!define isUpdated \`"1" == "1"\`` 会编译
; 不过：`${If} ${isUpdated}` 展开成 `${If} "1" == "1"`，而 LogicLib 的 `_If`
; 收的是四个参数（`_a _b _t _f`），少一个就报「requires 4 parameter(s)」。
; 照抄 `"" isUpdated ""` 这个带**空操作数**的形状，`${If}` 那一层才会把它
; 当成一个三元的条件往下传。

!macro _isUpdated _a _b _t _f
  StrCmp "true" "true" `${_t}` `${_f}`
!macroend
!define isUpdated `"" isUpdated ""`
