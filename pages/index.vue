<template>
  <div>
    <div class="container-fluid">

      <home-hero
        :slider="slider"
        class="home-section"
      />

      <static-section
        v-if="hasSiteFeatures"
        :site-features="siteFeatures"
      />

      <flashSale
        :flash-sales="flashSales"
      />

      <product-banner
        :banner-data="bannerData"
      />

      <products-slider
        v-for="(value, index) in productCollection"
        :key="index"
        :collection="value"
      />

      <featured
        class="category-wrapper"
        :title="$t('searchPopup.categories')"
        type="subCategory"
        :item-list="featuredCategories"
      />
      <div
        class="brands-wrapper"
        :class="{'full-screen': !featuredBanner}"
      >
        <div
          class="brands-inner"
        >
          <featured-brands
            class="featured-brands"
            :title="$t('listingLayout.brands')"
            :has-featured-banner="!!featuredBanner"
            :item-list="featuredBrands"
          />
        </div>

        <div class="brand-banner">
          <banner
            v-if="featuredBanner"
            :banner="featuredBanner"
          />
        </div>
      </div>

      <div
        v-if="productGrid"
        class="area home-section grid-product-wrapper">
        <div class="flex sided title">
          <h4>{{ productGrid.title }}</h4>
          <nuxt-link
            class="link"
            :to="collectionLink(collectionLinkObj)"
          >
            {{ $t('featured.showAll') }}
          </nuxt-link>
        </div>
        <client-only>
          <div class="search-product-tile">
            <searched-product-tile
              v-for="(value, index) in this.productGrid?.product_collections"
              :key="`prod-${index}`"
              :product="value"
            />
          </div>
        </client-only>
      </div>

      <banner
        v-if="banner5"
        class="home-section mb-0 br-primary flow-hidden"
        :banner="banner5"
      />

      <lazy-area
        v-slot:default="{renderArea}"
        class="mn-h-400x"
      >
        <discover
          v-if="renderArea"
        />
      </lazy-area>

      <banner
        v-if="banner6"
        class="home-section mt-0 br-primary flow-hidden"
        :banner="banner6"
      />
    </div>


  </div>

</template>

<script>

  import LazyArea from '~/components/LazyArea'
  import Discover from '~/components/Discover'
  import HomeHero from '~/components/HomeHero'
  import ImageSlider from '~/components/ImageSlider'
  import FlashSale from '~/components/FlashSale'
  import ProductsSlider from '~/components/ProductsSlider'
  import Featured from '~/components/Featured'
  import FeaturedBrands from '~/components/FeaturedBrands'
  import {mapGetters} from 'vuex'
  import util from '~/mixin/util'
  import global from '~/mixin/global'

  import StaticSection from "~/components/StaticSection"
  import SearchedProductTile from "~/components/SearchedPorductTile"
  import Banner from "../components/Banner";
  import ProductBanner from "../components/ProductBanner";

  export default {
    middleware: ['common-middleware'],
    head() {
      return {
        link: [
          {
            rel: 'preload',
            as: 'image',
            href: this.imageURL(this.heroMain)
          },
          {
            rel: 'preload',
            as: 'image',
            href: this.imageURL(this.heroRightTop)
          },
          {
            rel: 'preload',
            as: 'image',
            href: this.imageURL(this.heroRightBottom)
          },
        ],
      }
    },
    data() {
      return {}
    },
    components: {
      ProductBanner,
      Banner,
      SearchedProductTile,
      StaticSection,
      HomeHero,
      ImageSlider,
      FlashSale,
      ProductsSlider,
      Featured,
      Discover,
      LazyArea,
      FeaturedBrands
    },
    mixins: [util, global],
    computed: {
      hasSiteFeatures(){
        return this.siteFeatures?.length
      },
      heroMain() {
        return this.slider.main[0]
      },
      heroRightTop() {
        return this.slider.right_top
      },
      heroRightBottom() {
        return this.slider.right_bottom
      },
      banner5() {
        return this.bannerData?.banner5
      },
      banner6() {
        return this.bannerData?.banner6
      },
      featuredBanner() {
        return this.bannerData?.banner1
      },
      productCollection() {
        const col = [...this.collections]
        col.pop()
        return col
      },
      collectionLinkObj() {
        return this.productGrid
      },
      productGrid() {
        return this.collections.slice(-1).pop()
      },
      bannerData() {
        let banner = {
          banner1: null,
          banner2: null,
          banner3: null,
          banner4: null,
          banner5: null,
          banner6: null
        }
        this.banners.forEach(i => {
          banner['banner' + this.bannerType['BANNER_' + i.type]] = i
        })
        return banner
      },
      ...mapGetters('home', ['featuredCategories', 'flashSales', 'collections',
        'featuredBrands', 'slider', 'banners', 'siteFeatures'])
    },
    methods: {},
    async beforeCreate() {
    },
    async asyncData({store, error}) {

      if (!store.state?.home?.hasHomeData) {
        try {

          await store.dispatch('home/fetchHome', {
            payload: null,
            lang: store.state?.language?.langCode
          })
        } catch (e) {
          error(e)
        }
      }
    },
  }
</script>

