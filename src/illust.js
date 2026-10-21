// お客さま画面用のイラスト（水色ベース・線はやわらかく）。すべて自作のSVG。
const C = { sky: '#1E9BD7', skyD: '#137BB0', pale: '#E6F4FC', paper: '#F1F8FD', ink: '#14212B', line: '#BFDDF0', warm: '#F6C27A', leaf: '#8CC9A8' };

// ようこそ：スマホから吹き出しが出て、お店のホームページが直る
export const welcome = `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<ellipse cx="160" cy="186" rx="130" ry="10" fill="${C.pale}"/>
<rect x="40" y="38" width="150" height="128" rx="14" fill="#fff" stroke="${C.line}" stroke-width="3"/>
<rect x="40" y="38" width="150" height="24" rx="12" fill="${C.pale}"/><rect x="40" y="50" width="150" height="12" fill="${C.pale}"/>
<circle cx="56" cy="50" r="4" fill="${C.line}"/><circle cx="68" cy="50" r="4" fill="${C.line}"/>
<path d="M58 132 l20 -26 h74 l20 26 z" fill="${C.warm}" opacity=".9"/><rect x="66" y="132" width="98" height="22" rx="3" fill="#fff" stroke="${C.line}" stroke-width="2"/>
<path d="M78 106 q8 10 16 0 q8 10 16 0 q8 10 16 0 q8 10 16 0 q8 10 16 0" fill="none" stroke="#fff" stroke-width="3"/>
<rect x="74" y="74" width="60" height="7" rx="3.5" fill="${C.sky}"/><rect x="74" y="86" width="84" height="6" rx="3" fill="${C.line}"/>
<rect x="206" y="70" width="68" height="112" rx="14" fill="${C.ink}"/><rect x="212" y="80" width="56" height="92" rx="8" fill="#fff"/>
<rect x="222" y="92" width="40" height="16" rx="8" fill="${C.sky}"/><rect x="218" y="114" width="34" height="14" rx="7" fill="${C.pale}"/>
<rect x="226" y="134" width="36" height="14" rx="7" fill="${C.sky}"/>
<path d="M196 96 q-14 -22 -40 -30" fill="none" stroke="${C.sky}" stroke-width="3" stroke-dasharray="2 7" stroke-linecap="round"/>
<path d="M238 40 l4 10 l10 4 l-10 4 l-4 10 l-4 -10 l-10 -4 l10 -4 z" fill="${C.warm}"/>
<circle cx="28" cy="70" r="5" fill="${C.leaf}"/><circle cx="292" cy="150" r="4" fill="${C.sky}" opacity=".5"/>
</svg>`;

// まだ依頼がないとき：吹き出しとえんぴつ
export const empty = `<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<ellipse cx="100" cy="128" rx="74" ry="8" fill="${C.pale}"/>
<path d="M40 30 h96 a14 14 0 0 1 14 14 v40 a14 14 0 0 1 -14 14 h-56 l-22 18 v-18 h-18 a14 14 0 0 1 -14 -14 v-40 a14 14 0 0 1 14 -14 z" fill="#fff" stroke="${C.line}" stroke-width="3"/>
<rect x="44" y="50" width="70" height="7" rx="3.5" fill="${C.sky}"/><rect x="44" y="64" width="90" height="6" rx="3" fill="${C.line}"/><rect x="44" y="76" width="52" height="6" rx="3" fill="${C.line}"/>
<g transform="rotate(35 160 70)"><rect x="152" y="30" width="16" height="64" rx="3" fill="${C.warm}"/><path d="M152 94 h16 l-8 14 z" fill="#F3E2C6"/><path d="M157 103 h6 l-3 5 z" fill="${C.ink}"/><rect x="152" y="30" width="16" height="9" rx="3" fill="${C.skyD}"/></g>
</svg>`;

// 作成中：歯車と吹き出し
export const working = `<svg viewBox="0 0 120 90" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" class="spin-wrap">
<circle cx="60" cy="45" r="34" fill="${C.pale}"/>
<g class="spin" style="transform-origin:60px 45px"><circle cx="60" cy="45" r="14" fill="none" stroke="${C.sky}" stroke-width="8" stroke-dasharray="8 6"/></g>
<circle cx="60" cy="45" r="5" fill="${C.sky}"/>
</svg>`;

// 公開できた：チェックと小さな星
export const done = `<svg viewBox="0 0 120 90" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<circle cx="60" cy="46" r="30" fill="${C.sky}"/><path d="M47 47 l9 9 l18 -19" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M98 18 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3 z" fill="${C.warm}"/><circle cx="20" cy="30" r="4" fill="${C.leaf}"/><circle cx="102" cy="72" r="3" fill="${C.sky}" opacity=".5"/>
</svg>`;

// 担当者が対応：人の手で確認するときの、やわらかいアイコン
export const person = `<svg viewBox="0 0 120 90" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<circle cx="60" cy="46" r="34" fill="${C.pale}"/><circle cx="60" cy="36" r="12" fill="${C.sky}"/><path d="M38 70 q22 -26 44 0" fill="${C.sky}"/>
<path d="M88 22 h18 a6 6 0 0 1 6 6 v8 a6 6 0 0 1 -6 6 h-8 l-6 5 v-5 h-4 a6 6 0 0 1 -6 -6 v-8 a6 6 0 0 1 6 -6 z" fill="#fff" stroke="${C.line}" stroke-width="2"/>
<circle cx="94" cy="32" r="2" fill="${C.sky}"/><circle cx="100" cy="32" r="2" fill="${C.sky}"/><circle cx="106" cy="32" r="2" fill="${C.sky}"/>
</svg>`;

// ログイン画面：鍵と家
export const login = `<svg viewBox="0 0 220 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<ellipse cx="110" cy="110" rx="86" ry="8" fill="${C.pale}"/>
<path d="M60 58 l50 -34 l50 34" fill="none" stroke="${C.sky}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
<rect x="72" y="56" width="76" height="50" rx="6" fill="#fff" stroke="${C.line}" stroke-width="3"/>
<rect x="100" y="76" width="20" height="30" rx="4" fill="${C.pale}"/><circle cx="115" cy="92" r="2" fill="${C.skyD}"/>
<circle cx="168" cy="44" r="12" fill="none" stroke="${C.warm}" stroke-width="5"/><path d="M176 52 l18 18 m-6 -6 l5 -5 m-11 -1 l5 -5" stroke="${C.warm}" stroke-width="5" stroke-linecap="round"/>
<circle cx="44" cy="40" r="4" fill="${C.leaf}"/>
</svg>`;
