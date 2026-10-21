// Highlights the table-of-contents entry for the section being read.
(function () {
  const links = Array.from(document.querySelectorAll('.toc a[href^="#"]'));
  if (!links.length || !('IntersectionObserver' in window)) return;
  const byId = new Map(links.map(link => [link.getAttribute('href').slice(1), link]));
  const visible = new Set();
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) visible.add(entry.target.id);
      else visible.delete(entry.target.id);
    }
    const current = links.map(link => link.getAttribute('href').slice(1)).find(id => visible.has(id));
    if (!current) return;
    for (const link of links) link.classList.toggle('is-active', link === byId.get(current));
  }, { rootMargin: '-80px 0px -55% 0px' });
  for (const id of byId.keys()) {
    const section = document.getElementById(id);
    if (section) observer.observe(section);
  }
})();
