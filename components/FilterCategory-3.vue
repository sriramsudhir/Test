<template>
  <div class="category-wrapper">
      <nuxt-link
        v-if="categorySlug"
        to="/all-products/products"
        class="flex start mb-15"
        :custom="true"
      >
        <span class="flex" @click.prevent="$emit('going-next', '/all-products/products')">

          <i
            class="dimen-16x icon double-arrow-left-icon mr-5 opacity-6"
          />
          {{ $t('listingLayout.allProducts') }}
        </span>

      </nuxt-link>
    <ul>
      <li
        v-for="(cat, i) in categoryList"
        :key="i"
      >
        <nuxt-link
          :class="{active: categorySlug === cat.slug}"
          :to="categoryLink(cat)"
          :custom="true"
        >
          <span
            @click.prevent="$emit('going-next', categoryLink(cat))"
          >
            {{ cat.title }}
          </span>
        </nuxt-link>

        <ul
          v-if="cat.public_sub_categories"
        >
          <li
            v-for="(sub, j) in cat.public_sub_categories"
            :key="j"

          >
              <nuxt-link
                :class="{active: subCategorySlug === sub.slug}"
                :to="subCategoryLink(sub, cat)"
                :custom="true"
              >
                <span
                  @click.prevent="$emit('going-next', subCategoryLink(sub, cat))"
                >
                  {{ sub.title }}
                </span>
            </nuxt-link>

          </li>
        </ul>

      </li>
    </ul>
  </div>
</template>

<script>

  import util from '~/mixin/util'
  import {mapGetters} from 'vuex'

    export default {
      name: "FilterCategory",
      props: {

      },
      data() {
        return {

        }
      },
      components: {

      },
      mixins: [util],
      computed: {
        subCategorySlug(){
          return this.$route.params?.subCategory || null
        },
        categorySlug(){
          return this.$route.params?.category || null
        },
        categoryList() {
          if(this.categorySlug) {
            const selected = this.categories.find(i => {
              return this.categorySlug === i.slug
            })
            if(selected){
              return [selected]
            }
          }
          return this.categories?.map(({public_sub_categories, ...item}) => item)
        },
        ...mapGetters('common', ['categories'])
      },
      mounted() {
      },
      methods: {

      },
    }
</script>

<style scoped>

</style>
