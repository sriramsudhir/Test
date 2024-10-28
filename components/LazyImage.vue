<template>
    <img
      :data-src="lazySrc"
      :style="style"
      :alt="alt"
      :title="title"
      @error="onError"
      class="lazy-img"
      height="50"
      width="50"
    >
</template>

<script>
  import lozad from 'lozad'
  import util from '~/mixin/util'

  export default {
    name: 'LazyImage',
    props: {
      alt: {
        type: String,
        default: null,
      },
      title: {
        type: String,
        default: null,
      },
      backgroundColor: {
        type: String,
        default: '#d9f4eb',
      },
      lazySrc: {
        type: String,
        default: null,
      },
      lazySrcset: {
        type: String,
        default: null,
      },
    },
    data() {
      return {
        loading: true,
      }
    },
    mixins: [util],
    computed: {
      aspectRatio() {
        if (!this.width || !this.height) return null
        return (this.height / this.width) * 100
      },
      style() {
       // const style = { backgroundColor: this.backgroundColor }
        const style = {  }

        if (this.width) {
          style.width = `${this.width}px`
          if (!this.height) {
            style.height = `${this.width * 0.66}px`
          }
        }
        const applyAspectRatio = this.loading && this.aspectRatio

        if (applyAspectRatio) {
          style.height = (this.height) ? `${this.height}px` : `${this.applyAspectRatio}px`
        }
        return style
      },
    },
    mounted() {

      const setLoadingState = () => {
        this.loading = false
        this.$el.style.opacity = 1
      }

      this.$el.addEventListener('load', setLoadingState)
      this.$once('hook:destroyed', () => {
        this.$el.removeEventListener('load', setLoadingState)
      })

      const observer = lozad(this.$el, {
        load: function(el) {
          // Custom implementation to load an element
          el.src = el.getAttribute('data-src')
        }
      })
      observer.observe()
    },
    methods: {

      onError(e) {
        e.target.src = this.getImageURL()
      },
    },
  };
</script>
