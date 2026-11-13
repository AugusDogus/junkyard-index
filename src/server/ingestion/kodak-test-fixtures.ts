export const kodakTestRoot = `<html><head><link rel="canonical" href="https://kodakauto.co/"></head><body>
Kodak Auto Inc. American Auto Sales &amp; Parts, 647 Asheville Hwy, Strawberry Plains, TN 37871.
<a href="tel:8654012898">(865)401-2898</a>
parts stripped from our Salvage lot. American Auto Parts Division is a full service salvage yard. Pick and Pay here.
<a href="/pull-a-part">Search</a></body></html>`;

export function kodakTestCard(
  index = 0,
  title = "2009 DODGE CHARGER SE",
  vin = "2B3KA43D29H614022",
) {
  const id = `MENU_SECTION0_ITEM${index}`;
  return `<h4 data-aid="${id}_TITLE">${title}</h4>
<div data-aid="${id}_PRICE">#250041</div>
<div data-aid="${id}_DESC"><p><span>VIN: ${vin}</span></p><p>Engine: 2.7L</p><p>Color: Gray</p></div>
<img data-aid="${id}_IMAGE" src="data:image/gif;base64,AAAA" data-srclazy="//img1.wsimg.com/isteam/ip/874ec5a1-37b8-4882-b105-804723817fcf/250045.jpg/:/rs=w:360,h:270">`;
}

export function kodakTestInventory(cards = kodakTestCard()) {
  return `<html><head><link rel="canonical" href="https://kodakauto.co/pull-a-part"></head><body>
Kodak Auto Inc <a href="tel:8654012898">(865)401-2898</a>
<h2 data-aid="MENU_SECTION_TITLE_RENDERED"><span> Inventory List</span><hr/></h2>
<h3 data-aid="MENU_SECTION_TITLE_0">DODGE</h3>${cards}</body></html>`;
}
