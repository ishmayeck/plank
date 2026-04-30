// Shared label / option text constants for the posting form (used by
// both posting.ts and privmsg.ts compose). Frozen so callers can spread
// it into assignVars without accidental mutation.

export const POSTING_BBCODE_LABELS = Object.freeze({
  L_BBCODE_B_HELP: "Bold text: [b]text[/b]  (alt+b)",
  L_BBCODE_I_HELP: "Italic text: [i]text[/i]  (alt+i)",
  L_BBCODE_U_HELP: "Underline text: [u]text[/u]  (alt+u)",
  L_BBCODE_Q_HELP: "Quote text: [quote]text[/quote]  (alt+q)",
  L_BBCODE_C_HELP: "Code display: [code]code[/code]  (alt+c)",
  L_BBCODE_L_HELP: "List: [list]text[/list] (alt+l)",
  L_BBCODE_O_HELP: "Ordered list: [list=]text[/list]  (alt+o)",
  L_BBCODE_P_HELP: "Insert image: [img]http://image_url[/img]  (alt+p)",
  L_BBCODE_W_HELP: "Insert URL: [url]http://url[/url] or [url=http://url]URL text[/url]  (alt+w)",
  L_BBCODE_A_HELP: "Close all open bbCode tags",
  L_BBCODE_S_HELP: "Font color: [color=red]text[/color]  Tip: you can also use color=#FF0000",
  L_BBCODE_F_HELP: "Font size: [size=x-small]small text[/size]",
  L_FONT_COLOR: "Font colour",
  L_FONT_SIZE: "Font size",
  L_BBCODE_CLOSE_TAGS: "Close Tags",
  L_STYLES_TIP: "Tip: Styles can be applied quickly to selected text.",
});

export const POSTING_COLOR_LABELS = Object.freeze({
  L_COLOR_DEFAULT: "Default",
  L_COLOR_DARK_RED: "Dark Red",
  L_COLOR_RED: "Red",
  L_COLOR_ORANGE: "Orange",
  L_COLOR_BROWN: "Brown",
  L_COLOR_YELLOW: "Yellow",
  L_COLOR_GREEN: "Green",
  L_COLOR_OLIVE: "Olive",
  L_COLOR_CYAN: "Cyan",
  L_COLOR_BLUE: "Blue",
  L_COLOR_DARK_BLUE: "Dark Blue",
  L_COLOR_INDIGO: "Indigo",
  L_COLOR_VIOLET: "Violet",
  L_COLOR_WHITE: "White",
  L_COLOR_BLACK: "Black",
});

export const POSTING_FONT_SIZE_LABELS = Object.freeze({
  L_FONT_TINY: "Tiny",
  L_FONT_SMALL: "Small",
  L_FONT_NORMAL: "Normal",
  L_FONT_LARGE: "Large",
  L_FONT_HUGE: "Huge",
});
