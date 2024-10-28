<template>
  <div
    class="static-area"
  >
    <div class="img-wrap">

      <lazy-image
        :data-src="getImageURL(image)"
        :title="$t('date.fi')"
        :alt="$t('date.fi')"
      />
    </div>

    <div class="detail" v-html="detail"></div>
  </div>

</template>

<script>
  import util from '~/mixin/util'
  import LazyImage from "./LazyImage";
  export default {
    name: 'SiteFeature',
    data() {
      return {

      }
    },
    watch: {


    },
    props: {
      siteFeature: {
        type: Object,
        default() {
          return null
        }
      }
    },
    components: {
      LazyImage

    },
    computed: {
      image(){
        return this.siteFeature?.image
      },
      detail(){
        return this.siteFeature?.detail
      }
    },
    mixins: [util],
    methods: {

    },
    created() {
    },
    async mounted() {
    }


  }
</script>

