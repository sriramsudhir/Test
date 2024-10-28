<template>
  <category-listing-layout
    type="brand"
  />
</template>
<script>
  import global from '~/mixin/global'
  import CategoryListingLayout from "~/components/CategoryListingLayout";
  export default {
    middleware: ['common-middleware'],
    components: {
      CategoryListingLayout
    },
    head(){
      return {
      }
    },
    data() {
      return {
      }
    },
    mixins: [global],
    computed: {
    },
    methods: {
    },
    async mounted() {
    }
  }
</script>
