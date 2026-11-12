export const rustyhookTestHeader = `<title>Rusty Hook Auto Salvage</title><body>
<div class="Title">Rusty Hook Auto Salvage<p>in Pittsburgh</p>
<p>3015 Mt. Troy Rd.<br>Pittsburgh, PA 15212</p><p>(412) 657 - 9522 ext. 2</p></div>
<a href="index.php">Pittsburgh Yard</a><a href="index.php?E=LooseParts">Loose Parts</a>`;

export const rustyhookTestPosts = Array.from({ length: 26 }, (_, index) => ({
  url: `http://salvage.rustyhooktowing.com/index.php?E=Detail&ID=${25 - index}`,
  title: index === 25 ? "1958 Buick SPECIAL" : "2011 Jaguar XFR",
}));

export function rustyhookTestCatalog(page = 1, posts = rustyhookTestPosts) {
  const lastPage = Math.ceil(posts.length / 12);
  const pagination = `<h3>Previous ${Array.from(
    { length: lastPage },
    (_, index) => index + 1,
  )
    .map((number) =>
      number === page
        ? String(number)
        : `<a href="index.php?SPage=${number - 1}">${number}</a>`,
    )
    .join(" ")} Next</h3>`;
  return `${rustyhookTestHeader}${pagination}<table><tr><td>${posts
    .slice((page - 1) * 12, page * 12)
    .map(
      (post) =>
        `<div><h3><a href="${post.url.replaceAll("&", "&amp;")}">${post.title}</a></h3><a href="${post.url.replaceAll("&", "&amp;")}"><img src="thumbnail.jpg"></a></div>`,
    )
    .join("")}</td></tr></table>${pagination}</body></html>`;
}

export function rustyhookTestDetail(
  index = 0,
  overrides: Record<string, string> = {},
) {
  const post = rustyhookTestPosts[index];
  if (!post) throw new Error("Unknown fixture donor");
  const fields = {
    VIN:
      index === 25
        ? "XXXX00000E1031782"
        : "SAJWA0JC6BM" + String(100000 + index),
    "Stock Number": String(index).padStart(4, "0"),
    Year: index === 25 ? "1958" : "2011",
    Make: index === 25 ? "Buick" : "Jaguar",
    Model: index === 25 ? "SPECIAL" : "XFR",
    Mileage: "123456",
    Engine: "5.0L V8",
    Transmission: "Automatic",
    "Transfer Case": "RWD",
    "Axle Ratio": "3.31",
    "Body Style": "Sedan",
    "Interior Color": "Black",
    "Exterior Color": index === 25 ? "NA" : "Black",
    "Car Notes": "PARTS SOLD: starter. Car was parted out previous to testing.",
    ...overrides,
  };
  return `${rustyhookTestHeader}<h2>${post.title}</h2><img src="Salvage/${fields.VIN}/Images/first.jpg"><table>${Object.entries(
    fields,
  )
    .map(
      ([label, value]) =>
        `<tr><td><h3>${label}</h3></td></tr><tr><td>${value}</td></tr>`,
    )
    .join("")}</table></body></html>`;
}
