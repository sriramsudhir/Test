<template>
  <category-listing-layout
    :sub-categories-map="subCategoriesMap"
    type="subCategory"
  />
</template>
<script>
  import { mapGetters, mapActions } from 'vuex'
  import CategoryListingLayout from "~/components/CategoryListingLayout";
  import global from '~/mixin/global'


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
      ...mapGetters('common', ['subCategoriesMap', 'categories'])
    },
    methods: {
      ...mapActions('common', ['setSubCatMap', 'getRequest'])
    },
    async mounted() {
      if(!this.subCategoriesMap){
        this.setSubCatMap(this.categories)
      }
    }
  }
</script>
