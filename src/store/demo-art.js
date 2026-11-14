'use strict';
/** Original flat SVG art for the demo shop (v2.69). One square picture per product and per category. */

// House rules for every picture, so the grid reads as one set by one hand:
//   - viewBox 0 0 240 240, transparent (the shop card supplies the one background);
//   - the subject sits inside x,y 36..204; floor-standing things share a baseline near y=182
//     with one soft ground shadow;
//   - flat shapes only, no letters or digits, palette only:
//     #6d28d9 #4c1d95 #e8b84a #1c1430 #6b6280 #a39bb3 #eadfce #fff8ee #f4e9ff #ffffff;
//   - anything white, cream or sand carries an outline, or it vanishes on the light card.

function svg(body) { return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img">${body}</svg>\n`; }

const ART = {
  /* ---------- products ---------- */

  'demo-pet-stone.svg': svg(
    '<ellipse cx="120" cy="184" rx="80" ry="6" fill="#1c1430" fill-opacity="0.08"/>' +
    '<circle cx="41" cy="167" r="5" fill="#e8b84a"/><circle cx="199" cy="167" r="5" fill="#e8b84a"/>' +
    '<rect x="44" y="152" width="152" height="30" rx="14" fill="#6d28d9"/>' +
    '<path d="M62 172H178" stroke="#4c1d95" stroke-width="3" stroke-linecap="round"/>' +
    '<path d="M73 158C51 158 51 116 67 92C85 64 141 56 165 80C187 102 193 158 173 158Z" fill="#6b6280"/>' +
    '<path d="M77 112C85 92 105 82 125 80" fill="none" stroke="#a39bb3" stroke-width="5" stroke-linecap="round"/>' +
    '<circle cx="106" cy="124" r="5" fill="#1c1430"/><circle cx="138" cy="124" r="5" fill="#1c1430"/>' +
    '<circle cx="107.5" cy="122.5" r="1.5" fill="#ffffff"/><circle cx="139.5" cy="122.5" r="1.5" fill="#ffffff"/>'
  ),

  'demo-room-elephant.svg': svg(
    '<ellipse cx="124" cy="184" rx="84" ry="6" fill="#1c1430" fill-opacity="0.08"/>' +
    '<rect x="40" y="72" width="34" height="28" rx="3" fill="#fff8ee" stroke="#e8b84a" stroke-width="4"/>' +
    '<path d="M43 174V182M77 174V182" stroke="#1c1430" stroke-width="5"/>' +
    '<rect x="36" y="124" width="16" height="52" rx="7" fill="#6d28d9"/>' +
    '<rect x="36" y="150" width="48" height="26" rx="8" fill="#6d28d9"/>' +
    '<rect x="50" y="143" width="30" height="12" rx="6" fill="#4c1d95"/>' +
    '<path d="M96 100C86 104 84 116 86 128" fill="none" stroke="#6b6280" stroke-width="4" stroke-linecap="round"/>' +
    '<rect x="92" y="72" width="92" height="80" rx="34" fill="#6b6280"/>' +
    '<rect x="100" y="130" width="24" height="52" rx="5" fill="#6b6280"/>' +
    '<rect x="150" y="130" width="24" height="52" rx="5" fill="#6b6280"/>' +
    '<circle cx="172" cy="96" r="28" fill="#6b6280"/>' +
    '<path d="M190 106C198 122 196 148 188 160" fill="none" stroke="#6b6280" stroke-width="12" stroke-linecap="round"/>' +
    '<ellipse cx="158" cy="98" rx="15" ry="22" fill="#a39bb3"/>' +
    '<circle cx="182" cy="90" r="3.5" fill="#1c1430"/>'
  ),

  'demo-diy-mountain.svg': svg(
    '<ellipse cx="106" cy="184" rx="72" ry="6" fill="#1c1430" fill-opacity="0.08"/>' +
    '<polygon points="52,158 160,158 174,182 38,182" fill="#6d28d9"/>' +
    '<polygon points="68,129 144,129 157,153 55,153" fill="#4c1d95"/>' +
    '<polygon points="86,99 126,99 141,124 71,124" fill="#6d28d9"/>' +
    '<path d="M106 129V153M82 158V182M130 158V182" stroke="#f4e9ff" stroke-width="3"/>' +
    '<path d="M100 99V92M112 99V92" stroke="#e8b84a" stroke-width="4" stroke-linecap="round"/>' +
    '<polygon points="106,50 123,80 89,80" fill="#ffffff" stroke="#4c1d95" stroke-width="3" stroke-linejoin="round"/>' +
    '<path d="M162 98L184 90L198 132" fill="none" stroke="#e8b84a" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'
  ),

  'demo-starter-black-hole.svg': svg(
    '<path d="M50 62C72 56 90 66 98 82" fill="none" stroke="#a39bb3" stroke-width="3" stroke-linecap="round"/>' +
    '<rect x="38" y="54" width="12" height="12" rx="2" fill="#6d28d9" transform="rotate(20 44 60)"/>' +
    '<path d="M170 50C158 54 149 64 144 78" fill="none" stroke="#a39bb3" stroke-width="3" stroke-linecap="round"/>' +
    '<circle cx="174" cy="49" r="5" fill="#6b6280"/>' +
    '<path d="M188 178C172 180 154 170 146 156" fill="none" stroke="#a39bb3" stroke-width="3" stroke-linecap="round"/>' +
    '<circle cx="192" cy="178" r="6" fill="#e8b84a"/>' +
    '<g transform="rotate(-18 120 120)">' +
    '<ellipse cx="120" cy="120" rx="80" ry="22" fill="none" stroke="#e8b84a" stroke-width="5"/>' +
    '<circle cx="120" cy="120" r="49" fill="#f4e9ff" stroke="#e8b84a" stroke-width="3"/>' +
    '<circle cx="120" cy="120" r="42" fill="#1c1430"/>' +
    '<path d="M40 120A80 22 0 0 0 200 120" fill="none" stroke="#e8b84a" stroke-width="5" stroke-linecap="round"/>' +
    '</g>'
  ),

  'demo-left-sock.svg': svg(
    '<path d="M120 56H168V144C168 170 152 188 126 188H96C78 188 66 176 66 162C66 148 78 138 94 138H108C115 138 120 133 120 126Z" fill="#6d28d9"/>' +
    '<path d="M96 188C78 188 66 176 66 162C66 148 78 138 94 138C86 150 86 176 96 188Z" fill="#4c1d95"/>' +
    '<path d="M168 148C168 170 152 188 128 188C132 168 146 152 168 148Z" fill="#4c1d95"/>' +
    '<path d="M120 86H168M120 100H168" stroke="#f4e9ff" stroke-width="5"/>' +
    '<circle cx="134" cy="120" r="4" fill="#e8b84a"/><circle cx="154" cy="120" r="4" fill="#e8b84a"/>' +
    '<rect x="114" y="50" width="60" height="22" rx="7" fill="#e8b84a"/>'
  ),

  'demo-blank-card.svg': svg(
    '<rect x="62" y="62" width="136" height="82" rx="8" fill="#f4e9ff" stroke="#6d28d9" stroke-width="4" transform="rotate(-10 130 103)"/>' +
    '<rect x="44" y="98" width="136" height="82" rx="8" fill="#ffffff" stroke="#6d28d9" stroke-width="4" transform="rotate(6 112 139)"/>' +
    '<path d="M192 154l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#e8b84a"/>' +
    '<path d="M46 54l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#e8b84a"/>' +
    '<path d="M176 36l1.5 3.5 3.5 1.5-3.5 1.5-1.5 3.5-1.5-3.5-3.5-1.5 3.5-1.5z" fill="#e8b84a"/>'
  ),

  'demo-full-stop.svg': svg(
    '<ellipse cx="120" cy="184" rx="58" ry="6" fill="#1c1430" fill-opacity="0.08"/>' +
    '<rect x="72" y="168" width="96" height="14" rx="3" fill="#4c1d95"/>' +
    '<rect x="84" y="132" width="72" height="36" fill="#6d28d9"/>' +
    '<rect x="74" y="120" width="92" height="12" rx="3" fill="#4c1d95"/>' +
    '<path d="M86 120V82A34 34 0 0 1 154 82V120Z" fill="#ffffff" fill-opacity="0.6" stroke="#a39bb3" stroke-width="4" stroke-linejoin="round"/>' +
    '<path d="M99 84A22 22 0 0 1 111 65" fill="none" stroke="#a39bb3" stroke-width="3" stroke-linecap="round"/>' +
    '<circle cx="120" cy="44" r="5" fill="#e8b84a"/>' +
    '<rect x="104" y="115" width="32" height="5" rx="2" fill="#e8b84a"/>' +
    '<circle cx="120" cy="107" r="8" fill="#1c1430"/>'
  ),

  'demo-buttonhole.svg': svg(
    '<path d="M62 56H164L192 84V170a14 14 0 0 1-14 14H62a14 14 0 0 1-14-14V70a14 14 0 0 1 14-14Z" fill="#6d28d9"/>' +
    '<path d="M164 56L192 84H172a8 8 0 0 1-8-8Z" fill="#4c1d95"/>' +
    '<path d="M152 68H68a8 8 0 0 0-8 8V164a8 8 0 0 0 8 8H172a8 8 0 0 0 8-8V96" fill="none" stroke="#f4e9ff" stroke-opacity="0.6" stroke-width="3" stroke-dasharray="9 7" stroke-linecap="round"/>' +
    '<rect x="85" y="111" width="70" height="18" rx="9" fill="none" stroke="#e8b84a" stroke-width="10" stroke-dasharray="3 4"/>' +
    '<rect x="88" y="115" width="64" height="10" rx="5" fill="#1c1430"/>' +
    '<path d="M160 122C178 126 166 146 182 150C198 154 190 178 200 190" fill="none" stroke="#e8b84a" stroke-width="3" stroke-linecap="round"/>'
  ),

  'demo-bottled-quiet.svg': svg(
    '<ellipse cx="120" cy="184" rx="52" ry="6" fill="#1c1430" fill-opacity="0.08"/>' +
    '<path d="M106 62H134V86C134 100 162 104 162 128V168C162 176 156 182 148 182H92C84 182 78 176 78 168V128C78 104 106 100 106 86Z" fill="#1c1430"/>' +
    '<path d="M90 120C92 112 100 106 108 102" fill="none" stroke="#a39bb3" stroke-opacity="0.7" stroke-width="3" stroke-linecap="round"/>' +
    '<rect x="100" y="44" width="40" height="20" rx="5" fill="#e8b84a"/>' +
    '<rect x="104" y="71" width="32" height="6" rx="2" fill="#e8b84a"/>' +
    '<rect x="89" y="128" width="62" height="36" rx="4" fill="#fff8ee" stroke="#e8b84a" stroke-width="3"/>'
  ),

  'demo-music-cancelling.svg': svg(
    '<path d="M60 136V118A60 60 0 0 1 180 118V136" fill="none" stroke="#1c1430" stroke-width="8" stroke-linecap="round"/>' +
    '<rect x="42" y="124" width="34" height="60" rx="13" fill="#6d28d9"/>' +
    '<rect x="164" y="124" width="34" height="60" rx="13" fill="#6d28d9"/>' +
    '<rect x="72" y="132" width="10" height="44" rx="5" fill="#4c1d95"/>' +
    '<rect x="158" y="132" width="10" height="44" rx="5" fill="#4c1d95"/>' +
    '<ellipse cx="111" cy="156" rx="10" ry="7.5" fill="#1c1430" transform="rotate(-20 111 156)"/>' +
    '<path d="M119 154V118C128 120 134 126 135 136" fill="none" stroke="#1c1430" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="120" cy="140" r="30" fill="none" stroke="#e8b84a" stroke-width="5"/>' +
    '<path d="M99 161L141 119" stroke="#e8b84a" stroke-width="5" stroke-linecap="round"/>'
  ),

  'demo-used-whisper.svg': svg(
    '<path d="M74 52H138A28 28 0 0 1 166 80V104A28 28 0 0 1 138 132H98L76 154L80 132H74A28 28 0 0 1 46 104V80A28 28 0 0 1 74 52Z" fill="#ffffff" stroke="#6b6280" stroke-width="4" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="10 8"/>' +
    '<rect x="133" y="59" width="22" height="18" rx="3" fill="#eadfce" stroke="#6b6280" stroke-width="3" stroke-dasharray="3 3" transform="rotate(10 144 68)"/>' +
    '<circle cx="88" cy="92" r="4.5" fill="#a39bb3"/><circle cx="106" cy="92" r="4.5" fill="#a39bb3"/><circle cx="124" cy="92" r="4.5" fill="#a39bb3"/>' +
    '<polygon points="178,146 194,160 194,188 162,188 162,160" fill="#e8b84a" stroke="#e8b84a" stroke-width="4" stroke-linejoin="round"/>' +
    '<circle cx="178" cy="161" r="4" fill="#fff8ee"/>' +
    '<path d="M171 177H185" stroke="#1c1430" stroke-width="3" stroke-linecap="round"/>' +
    '<path d="M152 128C166 130 176 142 178 160" fill="none" stroke="#1c1430" stroke-width="3" stroke-linecap="round"/>'
  ),

  'demo-dnd-sign.svg': svg(
    '<path fill-rule="evenodd" d="M92 44H148A12 12 0 0 1 160 56V178A12 12 0 0 1 148 190H92A12 12 0 0 1 80 178V56A12 12 0 0 1 92 44ZM120 52A20 20 0 1 0 120 92A20 20 0 1 0 120 52Z" fill="#6d28d9"/>' +
    '<circle cx="120" cy="67" r="15" fill="#e8b84a"/>' +
    '<circle cx="115" cy="62" r="4" fill="#fff8ee" fill-opacity="0.8"/>' +
    '<path d="M98 112H142M98 126H130" stroke="#f4e9ff" stroke-width="5" stroke-linecap="round"/>' +
    '<path d="M118.6 141.1A15 15 0 1 0 133.9 161.6A13 13 0 0 1 118.6 141.1Z" fill="#e8b84a"/>'
  ),

  'demo-named-cloud.svg': svg(
    '<path d="M78 176A32 32 0 0 1 70.1 113A46 46 0 0 1 159.1 100A38 38 0 0 1 158 176Z" fill="#ffffff" stroke="#6d28d9" stroke-width="4" stroke-linejoin="round"/>' +
    '<path d="M90 81L120 124L141 80" fill="none" stroke="#4c1d95" stroke-width="3" stroke-linejoin="round"/>' +
    '<rect x="90" y="126" width="60" height="38" rx="6" fill="#e8b84a" stroke="#1c1430" stroke-width="3"/>' +
    '<path d="M91.5 139.5h57v18.5a4.5 4.5 0 0 1-4.5 4.5h-48a4.5 4.5 0 0 1-4.5-4.5Z" fill="#ffffff"/>' +
    '<path d="M102 152H138" stroke="#a39bb3" stroke-width="3" stroke-linecap="round"/>' +
    '<rect x="113" y="118" width="14" height="11" rx="2" fill="#1c1430"/>'
  ),

  'demo-mountain-air.svg': svg(
    '<ellipse cx="120" cy="184" rx="64" ry="6" fill="#1c1430" fill-opacity="0.08"/>' +
    '<polygon points="64,69 92,53 176,53 148,69" fill="#6b6280" stroke="#6b6280" stroke-width="3" stroke-linejoin="round"/>' +
    '<polygon points="148,69 176,53 176,166 148,182" fill="#a39bb3" stroke="#6b6280" stroke-width="3" stroke-linejoin="round"/>' +
    '<path d="M64 69l7 7 7-7 7 7 7-7 7 7 7-7 7 7 7-7 7 7 7-7 7 7 7-7V182H64Z" fill="#eadfce" stroke="#6b6280" stroke-width="3" stroke-linejoin="round"/>' +
    '<path d="M162 61V174" stroke="#6b6280" stroke-opacity="0.5" stroke-width="3"/>' +
    '<polygon points="78,160 100,116 111,134 120,122 136,160" fill="#4c1d95"/>' +
    '<circle cx="128" cy="102" r="6" fill="#e8b84a"/>'
  ),

  'demo-bw-rainbow.svg': svg(
    '<g fill="none" stroke-width="10">' +
    '<path d="M47 164V140A73 73 0 0 1 193 140V164" stroke="#1c1430"/>' +
    '<path d="M57 164V140A63 63 0 0 1 183 140V164" stroke="#6b6280"/>' +
    '<path d="M67 164V140A53 53 0 0 1 173 140V164" stroke="#a39bb3"/>' +
    '<path d="M77 164V140A43 43 0 0 1 163 140V164" stroke="#6b6280" stroke-opacity="0.4"/>' +
    '<path d="M87 164V140A33 33 0 0 1 153 140V164" stroke="#a39bb3" stroke-opacity="0.4"/>' +
    '</g>' +
    '<path d="M50 180A12 12 0 0 1 49 156A17 17 0 0 1 81.5 150.1A15 15 0 1 1 83 180Z" fill="#ffffff" stroke="#1c1430" stroke-width="4" stroke-linejoin="round"/>' +
    '<path d="M190 180A12 12 0 0 0 191 156A17 17 0 0 0 158.5 150.1A15 15 0 1 0 157 180Z" fill="#ffffff" stroke="#1c1430" stroke-width="4" stroke-linejoin="round"/>'
  ),

  'demo-yesterday-umbrella.svg': svg(
    '<ellipse cx="78" cy="182" rx="36" ry="7" fill="#6d28d9" fill-opacity="0.3"/>' +
    '<path d="M58 181H78" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>' +
    '<path d="M127 44V54" stroke="#1c1430" stroke-width="4" stroke-linecap="round"/>' +
    '<path d="M127 112V168a10 10 0 0 0 20 0" fill="none" stroke="#1c1430" stroke-width="5" stroke-linecap="round"/>' +
    '<path d="M59 118A68 68 0 0 1 195 118q-17-14-34 0q-17-14-34 0q-17-14-34 0q-17-14-34 0Z" fill="#6d28d9"/>' +
    '<path d="M127 50Q105 80 93 111M127 50Q149 80 161 111M127 50V110" fill="none" stroke="#4c1d95" stroke-width="3"/>'
  ),

  'demo-extra-tuesday.svg': svg(
    '<rect x="44" y="62" width="152" height="124" rx="10" fill="#ffffff" stroke="#6d28d9" stroke-width="4"/>' +
    '<path d="M44 94V72a10 10 0 0 1 10-10H186a10 10 0 0 1 10 10V94Z" fill="#6d28d9"/>' +
    '<path d="M102 80H138" stroke="#f4e9ff" stroke-width="5" stroke-linecap="round"/>' +
    '<path d="M82 52V72M158 52V72" stroke="#1c1430" stroke-width="5" stroke-linecap="round"/>' +
    '<path d="M52 110H188M52 130H188M52 150H188M52 170H188" stroke="#a39bb3" stroke-opacity="0.55" stroke-width="16" stroke-dasharray="16 4"/>' +
    '<rect x="117" y="117" width="26" height="26" rx="4" fill="#e8b84a" stroke="#ffffff" stroke-width="3" transform="rotate(12 130 130)"/>'
  ),

  'demo-five-more-minutes.svg': svg(
    '<ellipse cx="120" cy="184" rx="50" ry="6" fill="#1c1430" fill-opacity="0.08"/>' +
    '<circle cx="82" cy="60" r="16" fill="#4c1d95"/><circle cx="158" cy="60" r="16" fill="#4c1d95"/>' +
    '<path d="M120 48V64" stroke="#1c1430" stroke-width="5" stroke-linecap="round"/>' +
    '<path d="M88 162L78 180M152 162L162 180" stroke="#1c1430" stroke-width="5" stroke-linecap="round"/>' +
    '<circle cx="120" cy="118" r="56" fill="#6d28d9"/>' +
    '<circle cx="120" cy="118" r="44" fill="#fff8ee"/>' +
    '<path d="M120 118V74A44 44 0 0 1 142 79.9Z" fill="#e8b84a"/>' +
    '<path d="M156 118H150M120 154V148M84 118H90" stroke="#a39bb3" stroke-width="3" stroke-linecap="round"/>' +
    '<path d="M120 118V86M120 118L106 140" stroke="#1c1430" stroke-width="4" stroke-linecap="round"/>' +
    '<circle cx="120" cy="118" r="4" fill="#1c1430"/>'
  ),

  'demo-used-yesterday.svg': svg(
    '<path d="M56 48H152a8 8 0 0 1 8 8V152L128 184H56a8 8 0 0 1-8-8V56a8 8 0 0 1 8-8Z" fill="#ffffff"/>' +
    '<path d="M48 76V56a8 8 0 0 1 8-8H152a8 8 0 0 1 8 8V76Z" fill="#a39bb3"/>' +
    '<path d="M48 148L86 184" stroke="#a39bb3" stroke-width="3"/>' +
    '<path d="M56 48H152a8 8 0 0 1 8 8V152L128 184H56a8 8 0 0 1-8-8V56a8 8 0 0 1 8-8Z" fill="none" stroke="#6d28d9" stroke-width="4" stroke-linejoin="round"/>' +
    '<path d="M128 184V160a8 8 0 0 1 8-8H160Z" fill="#f4e9ff" stroke="#6d28d9" stroke-width="4" stroke-linejoin="round"/>' +
    '<path d="M80 138a24 24 0 0 1 48 0Z" fill="#e8b84a"/>' +
    '<path d="M104 104V96M82 112L76 106M126 112L132 106" stroke="#e8b84a" stroke-width="4" stroke-linecap="round"/>' +
    '<path d="M68 138H140" stroke="#6b6280" stroke-width="4" stroke-linecap="round"/>' +
    '<polygon points="186,112 200,126 200,154 172,154 172,126" fill="#e8b84a" stroke="#e8b84a" stroke-width="4" stroke-linejoin="round"/>' +
    '<circle cx="186" cy="127" r="4" fill="#fff8ee"/>' +
    '<path d="M179 143H193" stroke="#1c1430" stroke-width="3" stroke-linecap="round"/>' +
    '<path d="M146 62C170 58 188 86 186 126" fill="none" stroke="#1c1430" stroke-width="3" stroke-linecap="round"/>'
  ),

  'demo-nowhere-map.svg': svg(
    '<polygon points="44,74 92,58 148,74 196,58 196,170 148,186 92,170 44,186" fill="#ffffff" stroke="#6d28d9" stroke-width="4" stroke-linejoin="round"/>' +
    '<polygon points="92,60.2 148,76.2 148,183.8 92,167.8" fill="#eadfce"/>' +
    '<path d="M92 58V170M148 74V186" stroke="#6d28d9" stroke-width="3"/>' +
    '<path d="M62 160C70 128 100 146 116 124C130 104 150 122 164 104" fill="none" stroke="#1c1430" stroke-width="4" stroke-dasharray="7 8" stroke-linecap="round"/>' +
    '<circle cx="62" cy="160" r="5" fill="#1c1430"/>' +
    '<circle cx="172" cy="94" r="11" fill="#ffffff" stroke="#e8b84a" stroke-width="5"/>'
  ),

  'demo-chair-manual.svg': svg(
    '<ellipse cx="120" cy="184" rx="84" ry="6" fill="#1c1430" fill-opacity="0.08"/>' +
    '<rect x="47" y="58" width="10" height="124" rx="4" fill="#6d28d9"/>' +
    '<rect x="111" y="58" width="10" height="124" rx="4" fill="#6d28d9"/>' +
    '<rect x="47" y="58" width="74" height="14" rx="5" fill="#6d28d9"/>' +
    '<rect x="52" y="86" width="64" height="9" fill="#6d28d9"/>' +
    '<rect x="52" y="152" width="64" height="7" fill="#6d28d9"/>' +
    '<rect x="40" y="118" width="88" height="14" rx="5" fill="#4c1d95"/>' +
    '<g transform="rotate(7 168 139)">' +
    '<rect x="140" y="101" width="56" height="76" rx="5" fill="#ffffff" stroke="#6d28d9" stroke-width="4"/>' +
    '<circle cx="154" cy="121" r="4" fill="#e8b84a"/><circle cx="154" cy="139" r="4" fill="#e8b84a"/><circle cx="154" cy="157" r="4" fill="#e8b84a"/>' +
    '<path d="M166 121H184M166 139H184M166 157H178" stroke="#a39bb3" stroke-width="4" stroke-linecap="round"/>' +
    '</g>'
  ),

  'demo-wall-less-door.svg': svg(
    '<path d="M40 182H200" stroke="#6b6280" stroke-width="4" stroke-linecap="round"/>' +
    '<path d="M78 182V48H162V182" fill="none" stroke="#4c1d95" stroke-width="8"/>' +
    '<polygon points="82,52 136,62 136,172 82,182" fill="#6d28d9"/>' +
    '<polygon points="91,66 127,72 127,108 91,108" fill="none" stroke="#4c1d95" stroke-width="3" stroke-linejoin="round"/>' +
    '<polygon points="91,122 127,122 127,160 91,166" fill="none" stroke="#4c1d95" stroke-width="3" stroke-linejoin="round"/>' +
    '<circle cx="127" cy="115" r="5" fill="#e8b84a"/>'
  ),

  'demo-shelf-shelf.svg': svg(
    '<polygon points="58,158 84,158 58,182" fill="#e8b84a"/><polygon points="182,158 156,158 182,182" fill="#e8b84a"/>' +
    '<rect x="54" y="58" width="44" height="88" fill="#ffffff" stroke="#6d28d9" stroke-width="5" stroke-linejoin="round"/>' +
    '<path d="M54 80H98M54 102H98M54 124H98" stroke="#6d28d9" stroke-width="5"/>' +
    '<rect x="108" y="90" width="40" height="56" fill="#ffffff" stroke="#4c1d95" stroke-width="5" stroke-linejoin="round"/>' +
    '<path d="M108 118H148" stroke="#4c1d95" stroke-width="5"/>' +
    '<g transform="rotate(-10 159 146)">' +
    '<rect x="159" y="114" width="30" height="32" fill="#ffffff" stroke="#6b6280" stroke-width="5" stroke-linejoin="round"/>' +
    '<path d="M159 130H189" stroke="#6b6280" stroke-width="5"/>' +
    '</g>' +
    '<rect x="40" y="146" width="160" height="12" rx="3" fill="#4c1d95"/>'
  ),

  'demo-shy-mirror.svg': svg(
    '<ellipse cx="120" cy="184" rx="48" ry="6" fill="#1c1430" fill-opacity="0.08"/>' +
    '<path d="M120 162V174M92 180Q120 166 148 180" fill="none" stroke="#4c1d95" stroke-width="5" stroke-linecap="round"/>' +
    '<ellipse cx="112" cy="104" rx="42" ry="60" fill="#4c1d95"/>' +
    '<ellipse cx="122" cy="104" rx="42" ry="60" fill="#ffffff" stroke="#6d28d9" stroke-width="7"/>' +
    '<path d="M104 80L116 64M104 96L108 90" stroke="#a39bb3" stroke-width="3" stroke-linecap="round"/>' +
    '<ellipse cx="137" cy="128" rx="13" ry="8" fill="#6d28d9" fill-opacity="0.22"/>' +
    '<path d="M129 131L133 124M135 132L139 125M141 131L145 124" stroke="#6d28d9" stroke-opacity="0.6" stroke-width="3" stroke-linecap="round"/>'
  ),

  /* ---------- categories ---------- */

  'demo-cat-huge.svg': svg(
    '<ellipse cx="120" cy="186" rx="62" ry="6" fill="#1c1430" fill-opacity="0.08"/>' +
    '<circle cx="120" cy="98" r="54" fill="#6d28d9"/>' +
    '<path d="M85 79A40 40 0 0 1 110 57" fill="none" stroke="#f4e9ff" stroke-opacity="0.5" stroke-width="6" stroke-linecap="round"/>' +
    '<path d="M76.2 54.2L69.1 47.1M163.8 54.2L170.9 47.1M58 98H48M182 98H192" stroke="#e8b84a" stroke-width="5" stroke-linecap="round"/>' +
    '<path d="M78 132H162V180a4 4 0 0 1-4 4H82a4 4 0 0 1-4-4Z" fill="#eadfce" stroke="#6b6280" stroke-width="4" stroke-linejoin="round"/>' +
    '<polygon points="78,132 48,120 48,134 78,146" fill="#eadfce" stroke="#6b6280" stroke-width="4" stroke-linejoin="round"/>' +
    '<polygon points="162,132 192,120 192,134 162,146" fill="#eadfce" stroke="#6b6280" stroke-width="4" stroke-linejoin="round"/>'
  ),

  'demo-cat-small.svg': svg(
    '<path d="M152 148L190 186" stroke="#4c1d95" stroke-width="14" stroke-linecap="round"/>' +
    '<path d="M150 146L162 158" stroke="#e8b84a" stroke-width="14"/>' +
    '<circle cx="108" cy="104" r="54" fill="#ffffff" fill-opacity="0.7" stroke="#6d28d9" stroke-width="10"/>' +
    '<path d="M76 90A36 36 0 0 1 96 70" fill="none" stroke="#a39bb3" stroke-width="5" stroke-linecap="round"/>' +
    '<circle cx="106" cy="66" r="2.5" fill="#a39bb3"/>' +
    '<polygon points="108,95 117,104 108,113 99,104" fill="#e8b84a"/>'
  ),

  'demo-cat-quiet.svg': svg(
    '<path d="M150 98A24 24 0 0 1 150 142M168 78A48 48 0 0 1 168 162" fill="none" stroke="#a39bb3" stroke-width="8" stroke-linecap="round"/>' +
    '<path d="M82 100L124 66a4 4 0 0 1 6 3V171a4 4 0 0 1-6 3L82 140Z" fill="#6d28d9"/>' +
    '<rect x="52" y="98" width="36" height="44" rx="6" fill="#4c1d95"/>' +
    '<path d="M52 56L192 184" stroke="#e8b84a" stroke-width="10" stroke-linecap="round"/>'
  ),

  'demo-cat-weather.svg': svg(
    '<circle cx="150" cy="92" r="30" fill="#e8b84a"/>' +
    '<path d="M150 54V44M176.9 65.1L183.9 58.1M188 92H198M123.1 65.1L116.1 58.1M176.9 118.9L183.9 125.9" stroke="#e8b84a" stroke-width="6" stroke-linecap="round"/>' +
    '<path d="M70 184A28 28 0 0 1 68.5 128.1A38 38 0 0 1 140.7 118.4A33 33 0 1 1 146 184Z" fill="#ffffff" stroke="#6d28d9" stroke-width="5" stroke-linejoin="round"/>'
  ),

  'demo-cat-timeplace.svg': svg(
    '<circle cx="106" cy="110" r="58" fill="#ffffff" stroke="#6d28d9" stroke-width="8"/>' +
    '<path d="M106 62V68M154 110H148M58 110H64M106 158V152" stroke="#a39bb3" stroke-width="4" stroke-linecap="round"/>' +
    '<path d="M106 110V76M106 110L84 124" stroke="#1c1430" stroke-width="6" stroke-linecap="round"/>' +
    '<circle cx="106" cy="110" r="5" fill="#1c1430"/>' +
    '<path d="M168 194C152 172 140 158 140 142a28 28 0 0 1 56 0C196 158 184 172 168 194Z" fill="#e8b84a"/>' +
    '<circle cx="168" cy="142" r="10" fill="#ffffff"/>'
  ),

  'demo-cat-home.svg': svg(
    '<path d="M120 50L44 118M120 50L196 118M62 186V102M178 186V102M62 186H110M178 186H130" fill="none" stroke="#6d28d9" stroke-width="7" stroke-linecap="round" stroke-dasharray="10 14"/>' +
    '<rect x="104" y="133.5" width="32" height="56" rx="4" fill="#e8b84a"/>' +
    '<circle cx="128" cy="162" r="3.5" fill="#1c1430"/>'
  ),
};

module.exports = { ART };
