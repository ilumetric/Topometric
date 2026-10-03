// Runs before first paint so the sidebar does not jump.
// Collapsed by default; expanded only if the user expanded it before.
(function () {
  let collapsed = true;
  try { collapsed = localStorage.getItem('topometric-sidebar-collapsed') !== '0'; } catch (_) { }
  if (collapsed) document.body.classList.add('sidebar-collapsed');
})();
