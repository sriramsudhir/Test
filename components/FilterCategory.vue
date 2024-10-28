<template>
  <div class="category-wrapper">

    <ul class="table-tree">
      <tree-node
        v-for="value in categories"
        :node="value"
        :key="value.id"
      />
    </ul>


  </div>
</template>

<script>

  import util from '~/mixin/util'
  import {mapGetters} from 'vuex'
  import TreeNode from "./TreeNode";

    export default {
      name: "FilterCategory",
      props: {
        categories: {
          type: Array,
          default: []
        },
      },
      data() {
        return {

        }
      },
      components: {
        TreeNode

      },
      mixins: [util],
      computed: {
        categorySlug(){
          return this.$route.params?.category || null
        },
      },
      mounted() {
      },
      methods: {

      },
    }
</script>

<style scoped>

</style>
