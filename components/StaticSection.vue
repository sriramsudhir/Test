<template>
  <div
    class="flex wrap static-container mb-20 mb-sm-15"
  >

    <site-feature
      v-for="(value, i) in siteFeatures"
      :key="i"
      :site-feature="value"
    />

  </div>

</template>

<script>
  import SiteFeature from "./SiteFeature";
  export default {
    name: 'StaticSection',
    data() {
      return {

      }
    },
    watch: {


    },
    props: {
      siteFeatures: {
        type: Array,
        default: []
      }
    },
    components: {
      SiteFeature

    },
    computed: {

    },
    mixins: [],
    methods: {

    },
    created() {
    },
    async mounted() {
    }


  }
</script>

