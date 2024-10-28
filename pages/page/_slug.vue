<template>
  <div class="mt-20 pb-30 pb-sm-20">
    <sitemap
      v-if="isSitemap"
      :page-title="pageTitle"
      :page="page"
    />

    <component
      v-else-if="isPageFromComponent"
      :page-title="pageTitle"
      :is="currentComponent"
    />
    <div
      v-else
      class="mtb-20 mtb-sm-15 html-render"
    >
      <div class="container">
        <breadcrumb
          :page="pageTitle"
        />
        <div
          class="editor"
          v-dompurify-html="pageDescription"
        />
      </div>
    </div>
  </div>
</template>

<script>
  import { mapGetters } from 'vuex'
  import util from '~/mixin/util'
  import metaHelper from '~/mixin/metaHelper'
  import Sitemap from "~/components/Sitemap";
  import Breadcrumb from "~/components/Breadcrumb";
  import global from '~/mixin/global'

  export default {
    middleware: ['common-middleware'],
    components: {Breadcrumb, Sitemap},
    head() {
      return {
        title: this.page?.meta_title,
        meta: [
          this.generatingMeta('description', this.page?.meta_description),
          this.generatingMeta('keywords', this.page?.meta_keywords),
          this.generatingMeta('og:title', this.page?.meta_title),
          this.generatingMeta('og:description', this.page?.meta_description)
        ]
      }
    },
    data() {
      return {}
    },
    mixins: [util, metaHelper, global],
    computed: {
      pageDescription(){
        return this.page.description || null
      },
      allCategories(){
        return this.page?.categories || null
      },
      isSitemap(){
        return this.page?.description === 'Sitemap'
      },
      pageTitle(){
        return this.page?.title || ''
      },
      currentComponent(){
        return this.pageDescription
      },
      isPageFromComponent(){
        return parseInt(this.page.page_from_component) === parseInt(this.status.PUBLIC)
      },
      ...mapGetters('page', ['page'])
    },
    methods: {},
    async fetch({store, route, error}) {
      try {



        await store.dispatch('page/fetchPageData', {
          params: { slug: route?.params?.slug },
          lang: store.state?.language?.langCode,


        })
      } catch (e) {
        return error(e)
      }
    },
  }
</script>

<style>

</style>
