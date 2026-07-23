import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const routeDocuments = new Map();

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

function decodeEntities(value) {
  return value
    .replace(/&#x([0-9a-f]+);/giu, (_, codePoint) => String.fromCodePoint(Number.parseInt(codePoint, 16)))
    .replace(/&#([0-9]+);/gu, (_, codePoint) => String.fromCodePoint(Number.parseInt(codePoint, 10)))
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">");
}

function visibleText(html) {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
      .replace(/<template\b[^>]*>[\s\S]*?<\/template>/giu, " ")
      .replace(/<!--[\s\S]*?-->/gu, " ")
      .replace(/<[^>]+>/gu, " "),
  )
    .replace(/\s+/gu, " ")
    .trim();
}

function renderedContent(html) {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
      .replace(/<template\b[^>]*>[\s\S]*?<\/template>/giu, " ")
      .replace(/<!--[\s\S]*?-->/gu, " "),
  )
    .replace(/\s+/gu, " ")
    .trim();
}

async function getRouteDocument(pathname) {
  if (!routeDocuments.has(pathname)) {
    routeDocuments.set(
      pathname,
      (async () => {
        const response = await render(pathname);
        const html = await response.text();
        return { response, html, content: renderedContent(html), text: visibleText(html) };
      })(),
    );
  }

  return routeDocuments.get(pathname);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function assertContainsText(text, expected, pathname) {
  assert.match(text, new RegExp(escapeRegExp(expected), "iu"), `${pathname}: falta el texto «${expected}»`);
}

const referencedRoutes = [
  ["/registro", ["Crear Cuenta", "Regístrate para empezar a usar tu cuenta", "ID Vendedor"]],
  ["/cambiar-contrasena", ["Restablecer Contraseña", "Contraseña antigua", "CAMBIAR CONTRASEÑA"]],
  ["/recuperar", ["Recuperar Contraseña", "Ingresa tus datos", "ENVIAR CÓDIGO"]],
  ["/inicio", ["Buscar en Yape", "Mostrar saldo", "Mostrar movimientos", "Escanear QR", "Yapear"]],
  ["/movimientos", ["Movimientos", "Julio 2026"]],
  ["/transferir", ["Yapear", "Nuevo número", "Yaperos frecuentes", "Todos tus contactos"]],
  ["/servicios", ["Yapear Servicios", "Busca una empresa", "Te recomendamos yapear"]],
  ["/recargar", ["Recargar celular", "Últimos contactos recargados"]],
  ["/mi-qr", ["Mi QR", "Comparte y descarga tu QR"]],
  ["/perfil", ["Mi Perfil", "Yape es gratis", "Yape con BCP"]],
  ["/notificaciones", ["Notificaciones", "Yape para ti", "Ordena mejor tu dinero"]],
  ["/datos-cuenta", ["Datos de la cuenta", "Nombre del titular", "Cliente de ejemplo"]],
  ["/confirmacion-montos", ["Confirmación de yapeo alto", "Activar la confirmación"]],
  ["/limites-transaccionales", ["Límites transaccionales", "Límite configurado"]],
  ["/notificaciones-transferencias", ["Notificaciones por yapeo", "Recibir aviso por correo"]],
  ["/aprobar-compras", ["Aprobar compras", "Solicitudes por aprobar", "Código de aprobación"]],
  ["/ayuda", ["Centro de Ayuda", "Ayuda con un movimiento", "Asistente virtual"]],
  ["/dolares", ["Cambiar dólares con Yape es muy fácil", "Dólares al toque"]],
  ["/seguro-vehicular", ["¡Ten tu SOAT hoy mismo!", "Cotízalo sin compromiso"]],
  ["/biometria", ["Tienes activa tu biometría digital en Yape", "Desactivar biometría digital"]],
  ["/creditos", ["Créditos Yape", "Impulsa tu Historial Crediticio", "Simular crédito"]],
  ["/direcciones", ["Mis direcciones", "Nueva dirección"]],
  ["/compras-internet", ["Compras por internet", "Activar Compras por internet"]],
  ["/escanear-qr", ["Enfoca el código QR dentro del recuadro", "Encender linterna"]],
];

const allRoutes = ["/", ...referencedRoutes.map(([pathname]) => pathname)];

const referencePersonalData = /(?:\b(?:Helina|Aracelli|Tenorio|Macavilca|Yamsito|Natividad|Miriam|Luciana|Ronal|Olga|Fredy|Jes[uú]s)\b|Yamsito07|6716206585|98328654|41240435|SM-A155M|\*{2,}\s*\*{2,}\s*574|\b6930\b|te\*+@gmail\.com)/iu;
const visibleDemoText = /\b(?:demo|demostraci[oó]n)\b/iu;

test("server-renders the referenced login screen without starter or demo copy", async () => {
  const { response, html, content, text } = await getRouteDocument("/");

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  for (const expected of [
    "Iniciar Sesión",
    "Solo con @sebasrodriguez en Telegram",
    "ID Vendedor",
    "Crear una cuenta nueva",
    "Recuperar con correo",
  ]) {
    assertContainsText(content, expected, "/");
  }
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|SkeletonPreview/iu);
  assert.doesNotMatch(text, visibleDemoText);
});

test("server-renders the 24 referenced application routes and their key copy", async () => {
  assert.equal(referencedRoutes.length, 24);

  for (const [pathname, expectedTexts] of referencedRoutes) {
    const { response, content } = await getRouteDocument(pathname);
    assert.equal(response.status, 200, pathname);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i, pathname);

    for (const expected of expectedTexts) {
      assertContainsText(content, expected, pathname);
    }
  }
});

test("rendered routes contain neither photographed customer data nor visible DEMO labels", async () => {
  for (const pathname of allRoutes) {
    const { text } = await getRouteDocument(pathname);
    assert.doesNotMatch(text, referencePersonalData, `${pathname}: contiene datos personales de las referencias`);
    assert.doesNotMatch(text, visibleDemoText, `${pathname}: contiene un badge o texto DEMO visible`);
  }
});

test("critical original APK assets exist, are non-empty, and are referenced by key screens", async () => {
  const criticalAssets = [
    "resource-map.json",
    "fonts/yape_regular.ttf",
    "fonts/yape_medium.ttf",
    "fonts/yape_bold.ttf",
    "icons/ic_person_solid_yape_on_primary.svg",
    "icons/ic_search_yape_on_primary.svg",
    "icons/ic_headphone_solid_yape_on_primary.svg",
    "icons/ic_bell_b_yape_on_primary.svg",
    "icons/ic_eye_b_yape_primary.svg",
    "icons/ic_eye_slash_b_yape_primary.svg",
    "icons/ic_arrow_left_yape.svg",
    "icons/ic_arrow_left_yape_on_primary.svg",
    "icons/ic_refresh_yape_on_primary.svg",
    "icons/ic_mail_outline_yape_primary.svg",
    "icons/ic_chevron_right_yape_muted.svg",
    "icons/ic_qr_code_outline_yape_secondary.svg",
    "icons/ic_send_outline_yape_on_secondary.svg",
    "lottie/ic_gaming_animated_002.json",
    "lottie/ic_lending_animated_001.json",
    "lottie/ic_see_more_static_001.json",
    "icons/ic_bcp_logo.svg",
    "icons/ic_logo_pacifico.svg",
    "illustrations/ic_exchange_dollars_onboarding.svg",
    "illustrations/ic_sp_hand_bills_stars.svg",
    "illustrations/sh_phone_credit_limit_2000.svg",
    "illustrations/sp_contact_list.svg",
    "illustrations/sp_shield_fingerprint_check.svg",
    "illustrations/yapito_cash.svg",
    "images/img_lending_banner.png",
    "images/img_yape_tienda_banner.webp",
    "images/img_yapear_banner.webp",
    "images/img_offer_first_banner_purchasepyme.webp",
    "images/img_banner_1_purchaselife.webp",
    "images/jose_quinones.webp",
    "images/miguel_grau.webp",
    "images/abraham_valdelomar.webp",
    "images/pedro_paulet.webp",
    "images/santa_rosa_de_lima.webp",
    "images/qr_code_sample.png",
    "icons/ic_calendar_today_outline_yape.svg",
    "icons/ic_clock_outline_yape.svg",
    "icons/ic_share_outline_yape.svg",
    "icons/ic_yape_logo_r_yape_primary_700.svg",
    "lottie/change_password_security.json",
    "lottie/confetti_back.json",
    "lottie/confetti_front.json",
    "lottie/ic_tienda_cyber_animated_001.json",
    "lottie/lending_gift_loader.json",
    "lottie/logo.json",
  ];

  for (const relativePath of criticalAssets) {
    const file = await stat(new URL(`../public/assets/apk/${relativePath}`, import.meta.url));
    assert.ok(file.isFile(), `${relativePath}: no es un archivo`);
    assert.ok(file.size > 0, `${relativePath}: está vacío`);
  }

  const routeAssetReferences = [
    ["/", ["/assets/apk/icons/ic_refresh_yape_on_primary.svg"]],
    ["/inicio", [
      "/assets/apk/icons/ic_person_solid_yape_on_primary.svg",
      "/assets/captured/home/h_fondo1.jpg",
      "/assets/captured/home/h_fondo2.jpg",
      "/assets/captured/home/h_fondo3.jpg",
      "/assets/captured/home/h_fondo4.jpg",
      "/assets/captured/home/h_fondo5.jpg",
      "/assets/captured/home/h_fondo6.jpg",
      "/assets/apk/icons/ic_headphone_solid_yape_on_primary.svg",
      "/assets/apk/icons/ic_bell_b_yape_on_primary.svg",
      "/assets/apk/icons/ic_eye_b_yape_primary.svg",
      "/assets/apk/lottie/ic_tienda_cyber_animated_001.json",
      "/assets/icons/gaming.svg",
      "/assets/icons/remesas.svg",
      "/assets/icons/ver-todo.svg",
    ]],
    ["/movimientos", ["/assets/apk/images/img_yapear_banner.webp"]],
    ["/mi-qr", ["/assets/apk/images/qr_code_sample.png"]],
    ["/recargar", ["/assets/apk/illustrations/sp_contact_list.svg"]],
    ["/dolares", ["/assets/apk/illustrations/ic_exchange_dollars_onboarding.svg"]],
    ["/biometria", ["/assets/apk/illustrations/sp_shield_fingerprint_check.svg"]],
    ["/creditos", ["/assets/apk/lottie/lending_gift_loader.json"]],
  ];

  for (const [pathname, assetUrls] of routeAssetReferences) {
    const { html } = await getRouteDocument(pathname);
    for (const assetUrl of assetUrls) {
      assert.match(html, new RegExp(escapeRegExp(assetUrl), "u"), `${pathname}: no reutiliza ${assetUrl}`);
    }
  }
});

test("home promotions use a timed continuous carousel without credit banners", async () => {
  const source = await readFile(new URL("../app/components/BankApp.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/bank.css", import.meta.url), "utf8");
  const fidelityStyles = await readFile(new URL("../app/apk-fidelity.css", import.meta.url), "utf8");
  const { html } = await getRouteDocument("/inicio");
  const homeBannerBlock = source.match(/const homeBanners: PromoBanner\[\] = \[[\s\S]*?\n\];/u)?.[0] ?? "";

  assert.doesNotMatch(html, /img_lending_banner|banner_pds_lending_op/u);
  assert.equal((homeBannerBlock.match(/\{ id:/gu) ?? []).length, 6);
  for (let index = 1; index <= 6; index += 1) {
    const assetUrl = `/assets/captured/home/h_fondo${index}.jpg`;
    assert.match(homeBannerBlock, new RegExp(escapeRegExp(assetUrl), "u"), `falta el banner capturado ${assetUrl}`);

    const banner = await stat(new URL(`../public${assetUrl}`, import.meta.url));
    assert.ok(banner.isFile(), `${assetUrl}: no es un archivo`);
    assert.ok(banner.size > 0, `${assetUrl}: está vacío`);
  }
  assert.doesNotMatch(homeBannerBlock, /\/assets\/apk\/images\/(?:home_banner|img_offer|img_banner)/u);
  assert.doesNotMatch(homeBannerBlock, /img_yape_tienda_banner|img_yapear_banner|lending|credit/u);
  assert.match(source, /HOME_BANNER_DWELL_MS = 4000/u);
  assert.match(source, /HOME_BANNER_TRANSITION_MS = 500/u);
  assert.match(source, /HOME_BANNER_CYCLE_MS = HOME_BANNER_DWELL_MS \+ HOME_BANNER_TRANSITION_MS/u);
  assert.match(source, /if \(manualScrollTimer\.current !== null\)\s*\{[^}]*requestAnimationFrame\(animateCycle\);[^}]*return;/su);
  assert.match(source, /if \(position === carouselPosition\.current\)/u);
  assert.match(source, /const dwellProgress = Math\.min\(elapsed \/ HOME_BANNER_DWELL_MS, 1\)/u);
  assert.match(source, /progressNode\.style\.transform = `scaleX\(\$\{dwellProgress\}\)`/u);
  assert.match(source, /if \(!indicatorAdvanced\)\s*\{[^}]*setActiveBanner\(nextBannerIndex\);/su);
  assert.match(source, /startLeft \+ distance \* transitionProgress/u);
  assert.match(source, /window\.requestAnimationFrame\(animateCycle\)/u);
  assert.match(source, /card\.offsetLeft - firstCard\.offsetLeft/u);
  assert.match(source, /classList\.add\("is-auto-animating"\)/u);
  assert.match(source, /data-carousel-clone="true"/u);
  assert.doesNotMatch(styles, /@keyframes home-banner-progress/u);
  assert.match(fidelityStyles, /\.apk-banner-carousel\.is-auto-animating\s*\{[^}]*scroll-snap-type:\s*none;/su);
  assert.match(fidelityStyles, /\.apk-banner-carousel > img\s*\{[^}]*width:\s*min\(75vw, 322px\);[^}]*height:\s*min\(33vw, 142px\);[^}]*object-fit:\s*contain;[^}]*scroll-snap-stop:\s*always;/su);
  assert.match(fidelityStyles, /\.carousel-dots i\.is-active\s*\{[^}]*width:\s*min\(7vw, 30px\);/su);
  assert.doesNotMatch(styles, /\.home-purple-zone\s*\{[^}]*min-height:/su);
  assert.doesNotMatch(fidelityStyles, /\.home-purple-zone\s*\{[^}]*min-height:/su);
});

test("home keeps the referenced balance, static gaming and see-more icons, and animated store and credit access", async () => {
  const source = await readFile(new URL("../app/components/BankApp.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/bank.css", import.meta.url), "utf8");
  const creditLottie = JSON.parse(await readFile(new URL("../public/assets/apk/lottie/ic_lending_animated_001.json", import.meta.url), "utf8"));
  const storeLottie = JSON.parse(await readFile(new URL("../public/assets/apk/lottie/ic_tienda_cyber_animated_001.json", import.meta.url), "utf8"));
  const { content, html } = await getRouteDocument("/inicio");
  const serviceBlock = source.match(/const serviceItems: ServiceItem\[\] = \[[\s\S]*?\n\];/u)?.[0] ?? "";

  for (const expected of ["Créditos", "Gaming", "Tienda", "Viajar en bus", "Ver todo"]) {
    assertContainsText(content, expected, "/inicio");
  }

  assert.match(html, /\/assets\/apk\/lottie\/ic_lending_animated_001\.json/u);
  assert.match(html, /\/assets\/icons\/gaming\.svg/u);
  assert.match(html, /\/assets\/icons\/remesas\.svg/u);
  assert.match(html, /\/assets\/apk\/lottie\/ic_tienda_cyber_animated_001\.json/u);
  assert.match(html, /\/assets\/icons\/ver-todo\.svg/u);
  assert.deepEqual([storeLottie.w, storeLottie.h], [58, 58]);
  assert.deepEqual([creditLottie.w, creditLottie.h], [58, 58]);
  assert.ok(creditLottie.layers.some(({ nm }) => nm === "DESCUBRE contornos"));
  assert.ok(creditLottie.layers.some(({ nm }) => nm === "SI TIENES contornos"));
  assert.ok(creditLottie.layers.some(({ nm }) => nm === "CRÉDITO contornos"));
  assert.ok(storeLottie.layers.some(({ nm }) => nm === "70descuento contornos"));
  assert.ok(storeLottie.layers.some(({ nm }) => nm === "Hasta contornos"));
  assert.match(serviceBlock, /label: "Gaming", iconSrc: "\/assets\/icons\/gaming\.svg", badge: "Juega"/u);
  assert.match(serviceBlock, /label: "Viajar en bus", iconSrc: "\/assets\/icons\/remesas\.svg"/u);
  assert.doesNotMatch(serviceBlock, /Enviar al exterior/u);
  assert.match(serviceBlock, /label: "Ver todo", iconSrc: "\/assets\/icons\/ver-todo\.svg", fullTile: true/u);
  assert.doesNotMatch(serviceBlock, /Recargar Transportes/u);
  assert.doesNotMatch(serviceBlock, /yapito_gamer|¡Juega!/u);
  assert.doesNotMatch(serviceBlock, /label: "Tienda", iconSrc/u);
  assert.doesNotMatch(serviceBlock, /sp_world_arrow_money|animatedStore/u);
  assert.doesNotMatch(source, /function StoreIcon\(\)|store-icon-offer|store-icon-brand/u);
  assert.doesNotMatch(source, /function CreditIcon\(\)|animatedCredit/u);
  assert.match(styles, /\.account-disclosure > button > span\s*\{[^}]*color:\s*#2c2044;/su);
  assert.doesNotMatch(styles, /transition:\s*width 220ms ease, background 220ms ease/u);
});

test("movement rows open sent and received voucher variants", async () => {
  const source = await readFile(new URL("../app/components/BankApp.tsx", import.meta.url), "utf8");
  const { html } = await getRouteDocument("/movimientos");

  assert.match(html, /aria-label="Ver comprobante de Cliente Uno\*"/u);
  assert.match(html, /aria-label="Ver comprobante de Cliente Dos\*"/u);
  assert.match(source, /const \[selectedMovement, setSelectedMovement\] = useState<Movement \| null>\(null\)/u);
  assert.match(source, /return <MovementVoucher movement=\{selectedMovement\} onClose=\{\(\) => setSelectedMovement\(null\)\} \/>/u);
  assert.match(source, /sent \? "¡Yapeaste!" : "¡Te yapearon!"/u);
  assert.match(source, /sent \? "Destino" : "Origen"/u);
  assert.match(source, /aria-label="Volver a movimientos"/u);
  assert.match(source, /aria-label="Compartir comprobante"/u);
});

test("the Yapear voucher keeps every APK hero and the amount-based rotation", async () => {
  const source = await readFile(new URL("../app/components/BankApp.tsx", import.meta.url), "utf8");
  const expectedHeroes = [
    "jose_quinones",
    "miguel_grau",
    "abraham_valdelomar",
    "pedro_paulet",
    "santa_rosa_de_lima",
  ];

  for (const hero of expectedHeroes) {
    assert.match(source, new RegExp(`return [\"']${hero}[\"']`, "u"), `falta el héroe ${hero}`);
  }

  for (const threshold of [20, 50, 100, 200, 1001]) {
    assert.match(source, new RegExp(`amountValue < ${threshold}`, "u"), `falta el umbral S/${threshold}`);
  }
});

test("the Yapear amount screen and voucher use the captured interaction and promotion assets", async () => {
  const source = await readFile(new URL("../app/components/BankApp.tsx", import.meta.url), "utf8");
  const fidelityStyles = await readFile(new URL("../app/apk-fidelity.css", import.meta.url), "utf8");
  const globalStyles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const successAnimationUrl = "/assets/captured/lottie/animacion_yape.json";
  const successAnimation = JSON.parse(await readFile(new URL(`../public${successAnimationUrl}`, import.meta.url), "utf8"));
  const singlePromoStart = source.indexOf("function VoucherSinglePromo");
  const singlePromoEnd = source.indexOf("\nfunction TransferView", singlePromoStart);
  const singlePromoBlock = source.slice(singlePromoStart, singlePromoEnd);

  assert.match(source, new RegExp(escapeRegExp(successAnimationUrl), "u"));
  assert.deepEqual([successAnimation.w, successAnimation.h, successAnimation.fr], [375, 812, 40]);
  assert.doesNotMatch(source, /name="confetti_(?:back|front)"/u);
  assert.match(source, /aria-label="Nombre del destinatario"/u);
  assert.match(source, /aria-label="Número del destinatario"/u);
  assert.match(source, /recipientIsNewNumber/u);
  assert.match(source, /Límite por yapeo S\/500, límite por día S\/2,000/u);
  assert.equal((source.match(/<LottiePlayer name="logo" loop=\{false\} freezeAtFrame=\{80\} className="voucher-logo-lottie" \/>/gu) ?? []).length, 1);
  assert.doesNotMatch(source, /check_yape\.json/u);
  assert.match(source, /SIMULACIÓN LOCAL · SIN VALIDEZ/u);
  assert.match(source, /function formatVoucherDate\(date: Date\)/u);
  assert.match(source, /function formatVoucherTime\(date: Date\)/u);
  assert.match(source, /completedAt: new Date\(\)/u);
  assert.match(source, /code: String\(Math\.floor/u);
  assert.match(source, /operation: String\(Math\.floor/u);
  assert.doesNotMatch(source, /const formattedDate = voucher \? "17 jul\. 2026"/u);
  assert.doesNotMatch(source, /const formattedTime = voucher \? "04:12 a\. m\."/u);
  assert.match(source, />CÓDIGO DE SEGURIDAD\s*</u);
  assert.match(source, />DATOS DE LA TRANSACCIÓN\s*</u);
  assert.match(source, />\s*Nuevo Yapeo\s*</u);
  assert.match(source, />\s*Necesito ayuda\s*</u);
  assert.match(singlePromoBlock, /className="voucher-single-promo-frame"/u);
  assert.match(singlePromoBlock, /aria-label="Ir a Créditos: pide tu crédito preaprobado"/u);
  assert.doesNotMatch(singlePromoBlock, /useEffect|setTimeout|setInterval/u);
  assert.doesNotMatch(source, /VoucherPromoCarousel|VoucherDynamicPromo|voucher-promo-viewport|voucher-promo-dots/u);
  const promotionAssetUrl = "/assets/reference/mas-en-yape-banner.png";
  const promotion = await stat(new URL(`../public${promotionAssetUrl}`, import.meta.url));
  assert.match(source, new RegExp(escapeRegExp(promotionAssetUrl), "u"));
  assert.ok(promotion.isFile());
  assert.ok(promotion.size > 0);
  for (const [file, weight] of [["roboto_regular.ttf", "400"], ["roboto_medium.ttf", "500 600"], ["roboto_bold.ttf", "700"]]) {
    const fontUrl = `/assets/apk/fonts/${file}`;
    const font = await stat(new URL(`../public${fontUrl}`, import.meta.url));
    assert.match(globalStyles, new RegExp(`${escapeRegExp(fontUrl)}[\\s\\S]*?font-weight:\\s*${escapeRegExp(weight)}`, "u"));
    assert.ok(font.isFile());
    assert.ok(font.size > 0);
  }
  assert.match(fidelityStyles, /\.transfer-amount-field\s*\{[^}]*margin-top:\s*min\(25vw, 103px\);/su);
  assert.match(fidelityStyles, /\.transfer-amount-actions\s*\{[^}]*width:\s*min\(90vw, 371px\);/su);
  assert.match(fidelityStyles, /\.yape-success-voucher\s*\{[^}]*background:\s*#660185;[^}]*font-family:\s*Roboto, sans-serif;/su);
  assert.match(fidelityStyles, /\.yape-success-voucher \.voucher-card\s*\{[^}]*margin:\s*max\(-3vw, -13px\) auto 2vh;/su);
  assert.match(fidelityStyles, /\.yape-success-voucher \.voucher-amount\s*\{[^}]*align-items:\s*flex-start;[^}]*gap:\s*min\(2vw, 8px\);/su);
  assert.match(fidelityStyles, /\.yape-success-voucher \.voucher-recipient\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*flex-start;[^}]*align-items:\s*center;[^}]*padding-top:\s*1vw;[^}]*color:\s*#212e41;[^}]*font-family:\s*Roboto, sans-serif;[^}]*font-size:\s*5\.5vw;[^}]*font-weight:\s*700;[^}]*font-style:\s*normal;[^}]*letter-spacing:\s*normal;[^}]*text-transform:\s*none;/su);
  assert.match(fidelityStyles, /\.yape-success-voucher \.voucher-datetime\s*\{[^}]*width:\s*100%;[^}]*justify-content:\s*flex-start;[^}]*padding:\s*2\.5vw 0 4vw;[^}]*color:\s*#6d6d6d;[^}]*font-family:\s*Roboto, sans-serif;[^}]*font-size:\s*4\.3vw;[^}]*font-weight:\s*500;[^}]*font-style:\s*normal;[^}]*letter-spacing:\s*normal;/su);
  assert.match(fidelityStyles, /\.voucher-datetime img\s*\{[^}]*width:\s*4vw;[^}]*height:\s*4vw;[^}]*margin-right:\s*1\.5vw;[^}]*object-fit:\s*contain;/su);
  assert.match(fidelityStyles, /\.voucher-datetime i\s*\{[^}]*margin:\s*0 1\.5vw;[^}]*font-style:\s*normal;/su);
  assert.match(fidelityStyles, /\.yape-success-voucher \.voucher-security\s*\{[^}]*width:\s*100%;[^}]*padding:\s*4vw 0;[^}]*border-top:\s*0\.3vw solid #f0f0f0;[^}]*border-bottom:\s*0\.3vw solid #f0f0f0;/su);
  assert.match(fidelityStyles, /\.yape-success-voucher \.voucher-section-label\s*\{[^}]*color:\s*#726f7e;[^}]*font-family:\s*Roboto, sans-serif;[^}]*font-size:\s*3vw;[^}]*font-weight:\s*600;[^}]*font-style:\s*normal;[^}]*letter-spacing:\s*normal;[^}]*text-transform:\s*none;/su);
  assert.match(fidelityStyles, /\.voucher-security-digits span\s*\{[^}]*width:\s*6vw;[^}]*height:\s*6vw;[^}]*margin:\s*0 0\.5vw;[^}]*padding:\s*1vw;[^}]*border-radius:\s*1vw;[^}]*color:\s*#191120;[^}]*background-color:\s*#edecf4;[^}]*font-size:\s*4\.5vw;[^}]*font-weight:\s*500;/su);
  assert.match(fidelityStyles, /\.voucher-details > \.voucher-section-label\s*\{[^}]*padding:\s*4vw 0 3vw;/su);
  assert.match(fidelityStyles, /\.voucher-details > div\s*\{[^}]*width:\s*100%;[^}]*justify-content:\s*space-between;[^}]*align-items:\s*center;[^}]*padding:\s*1vw 0;[^}]*color:\s*#231b3a;[^}]*font-size:\s*3\.9vw;/su);
  assert.match(fidelityStyles, /\.voucher-details > div > span:first-child\s*\{[^}]*font-weight:\s*400;/su);
  assert.match(fidelityStyles, /\.voucher-details strong\s*\{[^}]*font-weight:\s*500;/su);
  assert.match(fidelityStyles, /\.voucher-single-promo-frame\s*\{[^}]*margin-top:\s*min\(2vw, 9px\);[^}]*border-radius:\s*min\(4vw, 17px\);/su);
});
