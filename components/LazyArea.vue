<template>
  <div>
    <slot
      :renderArea="renderArea"
    />
  </div>
</template>

<script>

  export default {
    name: 'LazyArea',
    props: {
      rootMargin: {
        type: Number,
        default: () => 0,
      },
    },
    data() {
      return {
        renderArea: false,
      };
    },
    mixins: [],
    computed: {
    },
    mounted() {
      const options = {
        rootMargin: `${this.rootMargin}px`,
      };
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.intersectionRatio > 0) {
            this.renderArea = true
            observer.disconnect(entry.target)
          }
        })
      }, options)
      observer.observe(this.$el)
    },
    methods: {
    },
  };
</script>

