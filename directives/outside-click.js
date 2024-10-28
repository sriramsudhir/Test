export default {
  bind: function (el, binding, vnode) {
    el.eventSetDrag = function () {
      el.setAttribute('data-dragging', 'yes');
    }
    el.eventClearDrag = function () {
      el.removeAttribute('data-dragging');
    }
    el.eventOnClick = function (event) {
      if (event.which === 3) {
        return false
      }

      const dragging = el.getAttribute('data-dragging');
      // Check that the click was outside the el and its children, and wasn't a drag

      const ignoreData = event.target.getAttribute('data-ignore')
      const ignoreId = el.getAttribute('id')

      if (ignoreData && ignoreId && ignoreData === ignoreId) {
        return false
      }

      if (!(el === event.target || el.contains(event.target)) && !dragging) {
        // call method provided in attribute value
        vnode.context[binding.expression](event);
      }
    };
    document.addEventListener('touchstart', el.eventClearDrag);
    document.addEventListener('touchmove', el.eventSetDrag);
    document.addEventListener('mousedown', el.eventOnClick);
    document.addEventListener('touchend', el.eventOnClick);
  }, unbind: function (el) {
    document.removeEventListener('touchstart', el.eventClearDrag);
    document.removeEventListener('touchmove', el.eventSetDrag);
    document.removeEventListener('mousedown', el.eventOnClick);
    document.removeEventListener('touchend', el.eventOnClick);
    el.removeAttribute('data-dragging');
  },
}
