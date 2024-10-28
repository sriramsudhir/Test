<template>
  <div class="item">
    <div
      v-for="(category, i) in categories"
      :key="`c-${i}`"
      class="category"
    >

      <h4 class="title"><nuxt-link :to="categoryLink(category)">{{ category.title }}</nuxt-link></h4>

      <div class="content">


        <div
          v-for="(subCat, j) in category.public_sub_categories"
          :key="`sub-cat-${i}-${j}`"
          class="sub-category"
        >
          <h4><nuxt-link :to="subCategoryLink(subCat, category)">{{ subCat.title }}</nuxt-link></h4>




          <div
            v-for="(product, k) in subCat.products"
            :key="`p-${i}-${j}-${k}`"
            class="product"
          >
            <p><nuxt-link
              :to="productLink(product)"
              class="ellipsis ellipsis-2"
            >{{ product.title }}</nuxt-link></p>
          </div>

        </div>

      </div>



    </div>

  </div>
</template>

<script>
  import util from '~/mixin/util'

  export default {
    name: 'SitemapItem',
    data() {
      return {

      }
    },
    mixins: [util],
    watch: {},
    props: {
      categories: {
        type: Array,
        default() {
          return []
        }

      }
    },
    computed: {

    },
    methods: {
    }
  }
</script>
