'use strict';

/**
 * QA — product / teaser grid (bent-products / PRODUCTS). Title, price,
 * image, url. Zero-JS, no cart. Decompiler maps catalog / Woo / KSP-class
 * grids. Import must emit keyword BenTML and .pzn.
 */

const pzn = require('../src/pzn/index');
const { decompileHtml } = require('../src/pzn/decompile');
const { renderBlock } = require('../src/renderer');
const { getBlockDef, defaultDataFor } = require('../src/block-registry');
const bentml = require('../src/bentml');
const { htmlToBlocks } = require('../src/pzn/graduate');
const { huntBlocks } = require('../src/pzn/hunt');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const productsBlock = {
  type: 'products', id: 'pr1',
  data: {
    columns: 3,
    items: [
      { title: 'מחשב נייד', price: '₪3,499', image: '/demo/tile-1.svg', url: '/p/1' },
      { title: 'אוזניות', price: '₪199', image: '/demo/tile-2.svg', url: '/p/2' },
      { title: 'עכבר', price: '₪79', image: '/demo/tile-3.svg', url: '/p/3' }
    ]
  }
};

const page = {
  title: 't', slug: 't', direction: 'rtl', tags: [], meta: {},
  blocks: [productsBlock]
};

const doc = pzn.parse(pzn.serialize(pzn.fromTapuzPage(page)));
const back = pzn.toTapuzPage(doc);
const pr = back.blocks.find((b) => b.type === 'products');
check('products round-trips (3 items)', pr && pr.data.items.length === 3);
check('title + price + url survive', pr && pr.data.items[0].title === 'מחשב נייד'
  && pr.data.items[0].price === '₪3,499' && pr.data.items[1].url === '/p/2');
check('validates clean', pzn.validate(doc, { strict: false }).filter((i) => i.severity === 'error').length === 0);

const compiled = pzn.compile(doc);
const rendered = renderBlock(productsBlock, 'rtl');
check('compile: bent-products', /class="bent-products/.test(compiled) && /bent-product-price/.test(compiled));
check('render titles + prices', /מחשב נייד/.test(rendered) && /₪3,499/.test(rendered));
check('javascript: url neutralized', !/javascript:/i.test(renderBlock({
  type: 'products', id: 'e',
  data: { items: [{ title: 'x', price: '₪1', url: 'javascript:alert(1)' }] }
}, 'rtl')));
check('no <script> in output', !/<script/i.test(rendered));
check('registry + seed', !!getBlockDef('products') && (defaultDataFor('products').items || []).length >= 2);

const kw = bentml.compile(`BENTML 0.2

META {
  title: "חנות"
}

PRODUCTS(columns: 2) {
  PRODUCT(title: "מחשב נייד", price: "₪3,499", image: "/demo/tile-1.svg", url: "/p/1")
  PRODUCT(title: "אוזניות", price: "₪199", image: "/demo/tile-2.svg", url: "/p/2")
}
`);
check('keyword compiles PRODUCTS', kw.blocks[0] && kw.blocks[0].type === 'products'
  && kw.blocks[0].data.items.length === 2 && kw.blocks[0].data.columns === 2);
const src = bentml.decompile({ title: 'x' }, [productsBlock]);
check('decompile emits PRODUCTS/PRODUCT', /PRODUCTS/.test(src) && /PRODUCT\(/.test(src));
const round = bentml.compile(src);
check('keyword products round-trip', round.blocks[0].type === 'products'
  && round.blocks[0].data.items[0].title === 'מחשב נייד'
  && round.blocks[0].data.items[2].price === '₪79');

const kspGrid =
  '<div class="product-grid">'
  + '<div class="product-item"><a href="/item/laptop"><img src="/p1.jpg" alt="">'
  + '<h3 class="product-title">מחשב נייד</h3><span class="price">₪3,499</span></a></div>'
  + '<div class="product-item"><a href="/item/phones"><img src="/p2.jpg" alt="">'
  + '<h3 class="product-title">אוזניות</h3><span class="price">₪199</span></a></div>'
  + '<div class="product-item"><a href="/item/mouse"><img src="/p3.jpg" alt="">'
  + '<h3 class="product-title">עכבר</h3><span class="price">₪79</span></a></div>'
  + '</div>';

const land = htmlToBlocks(kspGrid);
check('decompile product-grid → products module',
  land.blocks.some((b) => b.type === 'products' && (b.data.items || []).length === 3
    && b.data.items[0].price && /3,499/.test(b.data.items[0].price))
  && !land.suggestedTools.includes('products'));

const woo = htmlToBlocks(
  '<ul class="products">'
  + '<li class="product"><a href="/shop/a"><img src="/a.jpg" alt="">'
  + '<h2 class="woocommerce-loop-product__title">חולצה</h2>'
  + '<span class="price"><span class="woocommerce-Price-amount">₪89</span></span></a></li>'
  + '<li class="product"><a href="/shop/b"><img src="/b.jpg" alt="">'
  + '<h2 class="woocommerce-loop-product__title">מכנס</h2>'
  + '<span class="price"><span class="woocommerce-Price-amount">₪129</span></span></a></li>'
  + '</ul>'
);
check('WooCommerce products list → products',
  woo.blocks.some((b) => b.type === 'products' && (b.data.items || []).length === 2));

const hunted = huntBlocks(kspGrid);
check('hunt maps product-grid → products',
  (hunted.blocks || []).some((b) => b.type === 'products' && (b.data.items || []).length === 3));

const own = htmlToBlocks(rendered);
check('our own bent-products HTML maps back',
  own.blocks.some((b) => b.type === 'products' && (b.data.items || []).length >= 2));

const imported = decompileHtml(
  '<html><head><title>חנות</title></head><body>' + kspGrid + '</body></html>'
);
check('import emits keyword PRODUCTS / PRODUCT',
  /PRODUCTS/.test(imported.bentml || '') && /PRODUCT\(/.test(imported.bentml || ''));
check('import emits .pzn bent-products',
  /bent-products/.test(imported.source || ''));

console.log('');
console.log(fail ? 'SMOKE PRODUCTS: FAIL' : 'SMOKE PRODUCTS: PASS');
process.exit(fail ? 1 : 0);
