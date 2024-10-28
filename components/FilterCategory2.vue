<template>
  <div class="category-wrapper">

    <ul v-if="!isCategoryPage">
      <li
        v-for="(item, i) in allCategories"
        :key="i"
      >
        <nuxt-link
          :to="categoryLink(item)"
          @click.stop="$emit('going-next', categoryLink(item))"
        >
          {{ item.title }}
        </nuxt-link>
      </li>
    </ul>
    <div v-else>
      <p class="mb-10">
        <router-link
          @click.native="$emit('close-filter')"
          :to="listingLink({title: $t('listingLayout.allProducts') })"
          class="flex start"
        >
          <i
            class="dimen-16x icon double-arrow-left-icon mr-5 opacity-6"
          />
          {{ $t('listingLayout.allProducts') }}
        </router-link>
      </p>
      <h5 class="mb-5 main-category">

        <nuxt-link
          v-if="category"
          :class="{'active': !subCategoryId}"
          :to="categoryLink(category)"
          class="bold"
          @click.stop="$emit('going-next', categoryLink(category))"
        >
          {{ categoryTitle }}
        </nuxt-link>
      </h5>
      <ul v-if="subCategories">
        <li :class="{'active': subCategoryId && subCategoryId.toString() === item.id.toString()}"
            v-for="(item, i) in subCategories"
            :key="i"
        >
          <nuxt-link
            :to="subCategoryLink(item)"
            @click.stop="$emit('going-next', subCategoryLink(item))"
          >
            {{ item.title }}
          </nuxt-link>
        </li>
      </ul>
    </div>
  </div>
</template>

<script>

  import util from '~/mixin/util'
  import {mapGetters} from 'vuex'

    export default {
      name: "FilterCategory",
      props: {
        category: {
          type: Object,
          default: null
        },
        subCategoryId: {
          type: String,
          default: null
        },
        isCategoryPage: {
          type: Boolean,
          default: false
        },
        allCategories: {
          type: Array,
          default() {
            return []
          }
        },
      },
      data() {
        return {

        }
      },
      components: {

      },
      mixins: [util],
      computed: {
        categoryTitle() {
          return this.category?.title
        },
        subCategories() {
          return this.category?.public_sub_categories
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
