/** Flat stick figures. No photographs and no real faces. */

const svg = (body) =>
  `<svg viewBox="0 0 200 160" class="art" aria-hidden="true">${body}</svg>`;

function person({ y = 0, leg = "", arm = "", scarf = false, air = false } = {}) {
  const dy = air ? -28 : y;
  return `
    <g transform="translate(0 ${dy})" fill="none" stroke="#134E4A" stroke-width="6" stroke-linecap="round">
      <circle cx="100" cy="28" r="12" fill="#F3D5C4" stroke="#0F5E5A"/>
      <path d="M100 40 v30"/>
      <path d="M100 50 ${arm || "l-22 16 M100 50 l18 12"}"/>
      <path d="M100 70 ${leg || "l-14 36 M100 70 l14 36"}"/>
      <rect x="112" y="46" width="16" height="28" rx="3" fill="#E07A3D" stroke="#9A3412" stroke-width="2"/>
      ${scarf ? `<path d="M90 48 h34" stroke="#E8A598" stroke-width="5"/>` : ""}
    </g>
    <rect x="28" y="132" width="144" height="8" rx="4" fill="#D7E4E2"/>`;
}

export function demoMarkup(id) {
  const figs = {
    cmj: person({ scarf: true }),
    repeat: person({ y: 0, scarf: true }),
    balance: person({ leg: "l-6 36 M100 70 l22 -8" }),
    situp: `<g fill="none" stroke="#134E4A" stroke-width="6" stroke-linecap="round">
      <circle cx="46" cy="78" r="11" fill="#F3D5C4" stroke="#0F5E5A"/>
      <path d="M56 82 h48 M104 82 l18 16 M70 82 l8 22"/>
      <rect x="78" y="70" width="22" height="14" rx="3" fill="#E07A3D" stroke="#9A3412" stroke-width="2"/>
    </g><rect x="28" y="120" width="144" height="8" rx="4" fill="#D7E4E2"/>`,
    react: `<rect x="40" y="36" width="120" height="88" rx="18" fill="#0F5E5A"/>
      <circle cx="100" cy="80" r="22" fill="#F4F7F6"/>
      <rect x="86" y="18" width="28" height="10" rx="3" fill="#E07A3D"/>`,
    step: person({ leg: "l-8 20 l14 8 M100 70 l16 28" }),
    sprint: `<g fill="none" stroke="#134E4A" stroke-width="6" stroke-linecap="round">
      <circle cx="70" cy="40" r="11" fill="#F3D5C4" stroke="#0F5E5A"/>
      <path d="M78 50 l24 10 M70 62 l30 -6 M74 74 l-16 28 M86 78 l22 24"/>
      <rect x="92" y="52" width="14" height="22" rx="3" fill="#E07A3D" stroke="#9A3412" stroke-width="2"/>
    </g>
    <path d="M24 132 h20 M156 132 h20" stroke="#9A3412" stroke-width="4"/>
    <rect x="28" y="136" width="144" height="6" rx="3" fill="#D7E4E2"/>`,
    shuttle: `<path d="M36 80 h128" stroke="#0F5E5A" stroke-width="4"/>
      <path d="M36 68 v24 M164 68 v24" stroke="#E07A3D" stroke-width="6"/>
      <g fill="none" stroke="#134E4A" stroke-width="6" stroke-linecap="round">
        <circle cx="100" cy="48" r="11" fill="#F3D5C4" stroke="#0F5E5A"/>
        <path d="M100 60 v22 M100 70 l-16 14 M100 70 l18 10 M100 82 l-12 28 M100 82 l16 28"/>
      </g>`
  };
  return `<div class="demo-fig demo-${id}">${svg(figs[id] || figs.cmj)}</div>`;
}

export function stepMarkup(id, n) {
  if (id === "situp") return demoMarkup("situp");
  if (id === "react") return demoMarkup("react");
  if (id === "sprint") return demoMarkup("sprint");
  if (id === "shuttle") return demoMarkup("shuttle");
  const poses = {
    cmj: [person({ scarf: true }), person({ y: 10, leg: "l-20 24 M100 70 l20 24", scarf: true }), person({ air: true, scarf: true })],
    repeat: [person({ scarf: true }), person({ air: true, scarf: true }), person({ y: 6, scarf: true })],
    balance: [person({}), person({ leg: "l-4 34 M100 70 l24 -6" }), person({ leg: "l-24 -6 M100 70 l4 34" })],
    step: [person({}), person({ leg: "l-10 18 M100 70 l18 22" }), person({})]
  };
  const art = poses[id]?.[n - 1];
  return art ? svg(art) : demoMarkup(id);
}

export function videoMarkup(id) {
  return `<video class="demo-video" autoplay muted loop playsinline poster="">
    <source src="./assets/demos/${id}.webm" type="video/webm" />
    <source src="./assets/demos/${id}.mp4" type="video/mp4" />
  </video>`;
}
