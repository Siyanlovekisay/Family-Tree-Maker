// =========================================
// PARALLAX: hero photo shifts with the mouse
// =========================================
const home = document.getElementById("home");
const bgImage = document.getElementById("bg-video");
const STRENGTH = 12; // how far the image moves (pixels)

home.addEventListener("mousemove", function (e) {
  const box = home.getBoundingClientRect();
  const x = (e.clientX - box.left) / box.width - 0.5;
  const y = (e.clientY - box.top) / box.height - 0.5;

  bgImage.style.transform =
    "scale(1.1) translate(" + (-x * STRENGTH) + "px, " + (-y * STRENGTH) + "px)";
});

// glide back to the center when the mouse leaves
home.addEventListener("mouseleave", function () {
  bgImage.style.transform = "scale(1.1) translate(0px, 0px)";
});

// =========================================
// SCROLL REVEAL: replays every time a section comes into view
// =========================================

// which elements animate in each section, and the delay between them (seconds)
const SECTION_ITEMS = {
  home:     { selector: ".hero-content h1, .pill-btn, .feature-card, .scroll-btn", step: 0.25 },
  about:    { selector: "h2, p", step: 0.15 },
  services: { selector: "h2, .section-intro, .card", step: 0.12 },
  contact:  { selector: "h2, .section-intro, .contact-card, .footer-note", step: 0.12 }
};

// watches sections (not single elements)
const sectionObserver = new IntersectionObserver(function (entries) {
  entries.forEach(function (entry) {
    const items = entry.target.querySelectorAll(".reveal");

    if (entry.isIntersecting) {
      // section is on screen: play the animation
      items.forEach(function (el) { el.classList.add("visible"); });
    } else {
      // section left the screen: reset so it can play again next time
      items.forEach(function (el) { el.classList.remove("visible"); });
    }
  });
}, { threshold: 0.3 });   // section counts as "in view" when 30% is visible

// set everything up
Object.keys(SECTION_ITEMS).forEach(function (id) {
  const section = document.getElementById(id);
  if (!section) return;

  const config = SECTION_ITEMS[id];

  section.querySelectorAll(config.selector).forEach(function (el, i) {
    el.classList.add("reveal");
    el.style.animationDelay = (i * config.step) + "s";   // staggered timing
  });

  sectionObserver.observe(section);
});