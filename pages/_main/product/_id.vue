<template>
  <div>

    <sticky-cart-btn
      :product-inventory="selectedInventory"
      :disabled="!statusPublic"
      :product="product"
      @cart-error="hasCartError"
    />
    <div v-if="product">

      <a
        v-if="product.store.whatsapp_btn"
        class="whatsapp-btn-wrap"
        target="_blank"
        :href="`https://wa.me/${product.store.whatsapp_number}?text=${product.store.whatsapp_default_msg}`"
      >
        <i
          class="icon whatsapp-icon"
        />
      </a>


      <div
        class="detail-menu hide-sm"
        v-if="currentCategories && currentCategories.length"
      >
        <div class=" container-fluid">
          <div class="mlr--15">
            <nuxt-link
              v-for="(value, i) in currentCategories"
              :title="value.title"
              :to="categoryLink(value, category)"
              :key="i"
            >
              {{ value.title }}
            </nuxt-link>
          </div>
        </div>
      </div>
      <div class="container-fluid mtb-15 mt-sm-10 mn-h-400x">
        <div>
          <breadcrumb
            class="mb-20 mb-sm-15"
            :slugs="preparedSlug"
            :page="productTitle"
          />
          <div class="product-detail">
            <div class="detail-left pr-30 pr-sm-0">
              <div class="flex start align-start block-md">
                <div class="product-main">
                  <div class="detail-image-wrapper">
                    <div
                      class="detail-image-inner"
                      :class="{'z-2': imagePopup}"
                    >
                      <product-images
                        v-if="productImage || productImageList"
                        ref="productImagesRef"
                        :title="productTitle"
                        :product="product"
                        :main-image="productImage"
                        :images="productImageList"
                        @image-popup="imagePopup = $event"
                        @add-to-wishlist="$refs.detailRight.wishListAction()"
                      />
                    </div>
                  </div>

                  <div class="pl-30 pl-md grow">
                    <h1 class="f-16">
                      {{ productTitle }}
                    </h1>
                    <div class="mt-10">
                      <rating-star
                        :rating="parseFloat(productRating)"
                      />
                      <span
                        class="f-10 ml-5 semi-bold color-lite">
                        {{ $t('productReview.reviews', {count: reviewCount}) }}
                      </span>
                    </div>

                    <div class="devider w-md-100 mtb-15">&nbsp;</div>

                    <div
                      v-if="endTime"
                      class="flex sided warning-msg ptb-10 plr-15 mb-15 wrap gap-10"
                    >
                      <h5 class="color-inherit">
                        {{ $t('product.shocking') }}
                      </h5>
                      <div class="gap-10 flex">
                        <h5 class="color-inherit">
                          {{ $t('product.endsIn') }}
                        </h5>
                        <b>
                          <countdown
                            :time-zone="product.time_zone"
                            :end-time="endTime"
                          />
                        </b>
                      </div>
                    </div>
                    <h4
                      class="mb-15 bold"
                      :class="[{'color-success': isInStock}, {'color-danger': !isInStock}]"
                    >
                      {{ inStock }}
                    </h4>
                    <div
                      v-if="bundleDeal"
                      class="two-sided mb-15">
                      <h6 class="left">
                        {{ $t('product.bundleDeal') }}
                      </h6>
                      <div class="right bundle-deal">
                        {{ bundleDeal.title }}
                      </div>
                    </div>

                    <div
                      v-if="brand"
                      class="two-sided mb-15">
                      <h6 class="left">
                        {{ $t('product.brand') }}
                      </h6>
                      <div class="right">

                        <nuxt-link
                          class="link"
                          :to="brandLink(product.brand)"
                        >
                          {{ brand }}
                        </nuxt-link>
                      </div>
                    </div>

                    <div ref="attrRef"></div>

                    <div
                      v-for="(value, index) in productAttributes"
                      :key="index"
                      class="two-sided mb-15"
                    >
                      <span
                        class="left"
                      >
                        {{value.title}}
                      </span>

                      <div class="start flex wrap gap-10">
                        <label
                          v-for="(av, avIndex) in value.values"
                          :key="`av-${avIndex}`"
                          class="rd-container rd-attr"
                        >
                          <input
                            type="radio"
                            :name="`${value.id}`"
                            v-model="clickedAttributes[value.id]"
                            :value="av.id"
                            @change="selectedAttribute({key: avIndex, value: av})"
                          >
                          <span class="rd-checkmark"></span>

                          <span class="input-content">{{ av.title }}</span>
                        </label>
                      </div>
                    </div>

                    <div
                      v-if="cartError.attribute"
                      class="two-sided mb-15 align-start">
                      <h6 class="left">
                      </h6>
                      <div class="right">
                        <p
                          class="error mb-10"
                        >
                          {{cartError.attribute}}
                        </p>
                      </div>
                    </div>

                    <div
                      class="wrap two-sided mb-15 align-start">
                      <h6 class="left">
                        {{ $t('product.refundWarranty') }}
                      </h6>
                      <div class="right">
                        <div class="mb-5">

                          <template v-if="refundable(product)">
                            <div>{{ $t('productHelper.refundable') }}</div>
                            <div class="mb-10 mt-5 block color-lite">{{ $t('productHelper.mindChange') }}</div>
                          </template>
                          <template v-else>
                            {{ this.$t('productHelper.notRefundable') }}
                          </template>
                        </div>

                        <div v-if="product.warranty">{{ warranty(product) }}</div>
                        <div class="mt-5">
                          {{ $t('product.authentic') }}
                        </div>
                      </div>
                    </div>


                    <div
                      v-if="vouchers && vouchers.length"
                      class="two-sided mb-15 ">
                      <h6 class="left">
                        {{ $t('accountLayout.vouchers') }}
                      </h6>
                      <div class="pos-rel ">
                        <div
                          class="right mlr--2-5 cp"
                          data-ignore="voucher-pop-over"
                          @click.passive="voucherPopOver = !voucherPopOver"
                        >
                          <span
                            v-for="(value, index) in vouchers"
                            :key="index"
                            class="no-click info-msg ptb-5 mlr-2-5 mb-5 f-9"
                          >
                            {{ $t('detailRight.off', { amount: getPriceType(value) }) }}
                          </span>
                        </div>
                        <pop-over
                          v-if="voucherPopOver"
                          :title="$t('filter.shop')"
                          @close="closeVoucherPopOver"
                          elem-id="voucher-pop-over"
                          :layer="false"
                        >
                          <template v-slot:content>
                            <vouchers
                              ref="voucherPagination"
                              :changing-route="false"
                            />
                          </template>
                        </pop-over>
                      </div>
                    </div>

                    <div
                      class="editor mt-30 mt-sm-15"
                      v-dompurify-html="overview"
                    />
                  </div><!-- plr-30 grow -->
                </div><!-- flex -->
              </div>
              <client-only>
                <div
                  class="ellipsis-para editor mt-30 mt-sm-15"
                  :class="{'expanded': descriptionExpand}"
                  v-dompurify-html="description"
                />
                <button
                  @click.prevent="descriptionToggle"
                  aria-label="Read less"
                  class="link mt-15 mb-5"
                >
                  {{ descriptionExpand ? $t('product.readLess') : $t('product.readMore') }}
                </button>
              </client-only>
            </div>
            <!-- product-detail -->

            <detail-right
              ref="detailRight"
              :product-inventory="selectedInventory"
              :disabled="!statusPublic"
              :product="product"
              @cart-error="hasCartError"
            />
          </div><!-- product-detail -->
        </div>

      </div><!-- container-fluid mtb-15 -->

      <client-only>
        <div
          :class="{'mx-h-0': !hasReview, 'review-loaded': !reviewLoaded}"
          class="container-fluid suggested-container mn-h-400x"
        >
          <lazy-area
            v-slot:default="{renderArea}"
          >
            <product-review
              v-if="renderArea"
              :id="product.id"
              class="b-t pt-20 pt-sm-15  "
              @has-review="fetchedReview"
            />
          </lazy-area>
        </div>

        <div
          class="container-fluid suggested-container mn-h-400x"
        >
          <lazy-area
            v-slot:default="{renderArea}"
          >
            <suggested-products
              v-if="renderArea"
              :product-id="productId"
            />
          </lazy-area>
        </div>
      </client-only>

    </div>
  </div>
</template>

<script>

  import {mapGetters, mapActions} from 'vuex'
  import util from '~/mixin/util'
  import productPriceHelper from '~/mixin/productPriceHelper'
  import metaHelper from '~/mixin/metaHelper'
  import productHelper from '~/mixin/productHelper'
  import ProductImages from '~/components/ProductImages'
  import DetailRight from '~/components/DetailRight'
  import LazyArea from '~/components/LazyArea'
  import SuggestedProducts from '~/components/SuggestedProducts'
  import ProductReview from '~/components/ProductReview'
  import moment from 'moment-timezone'
  import DOMPurify from 'dompurify';
  import Vouchers from "~/components/Vouchers";
  import PopOver from "~/components/PopOver";
  import Countdown from "~/components/Countdown";
  import RatingStar from "~/components/RatingStar";
  import Breadcrumb from "~/components/Breadcrumb";
  import global from '~/mixin/global'
  import Dropdown from "~/components/Dropdown";
  import StickyCartBtn from "~/components/StickyCartBtn";

  export default {
    middleware: ['common-middleware'],
    head() {
      return {
        title: this.product?.meta_title,
        meta: [
          this.generatingMeta('description', this.product?.meta_description),
          this.generatingMeta('keywords', this.product?.meta_keywords),
          this.generatingMeta('og:image', this.imageURL(this.product)),
          this.generatingMeta('og:title', this.product?.meta_title),
          this.generatingMeta('og:description', this.product?.meta_description)
        ],
        link: [
          {
            rel: 'preload',
            as: 'image',
            href: this.getThumbImageURL(this.productImage)
          },
        ],

      }
    },

    data() {
      return {
        clickedAttributes: [],
        cartError: {
          attribute: null,
          quantity: null,
        },
        selectedInventory: {},
        currentAttributes: [],
        descriptionExpand: false,
        optionChange: false,
        productInventory: null,
        imagePopup: false,
        hasReview: true,
        reviewLoaded: true,
        activatedPage: false,
        voucherPopOver: false,
      }
    },
    components: {
      StickyCartBtn,
      Dropdown,
      Breadcrumb,
      RatingStar,
      Countdown,
      PopOver,
      Vouchers,
      ProductImages,
      LazyArea,
      SuggestedProducts,
      DetailRight,
      ProductReview
    },
    mixins: [util, metaHelper, productHelper, productPriceHelper, global],
    computed: {
      description() {
        return this.product?.description || null
      },
      overview() {
        return this.product?.overview || null
      },
      reviewCount() {
        return this.product?.review_count || 0
      },
      productRating() {
        return this.product?.rating || 0
      },
      productImage() {
        return this.product?.image || null
      },
      productImageList() {
        return this.product?.images || null
      },
      timeDifference() {
        const len = this.product.id.toString()?.length
        let highest = ''
        for (let i = 1; i <= len; i++) {
          highest += '9'
        }
        return ((this.product.id / highest) * 100).toFixed(2)
      },
      endTime() {
        return this.product?.end_time || null
      },
      productId() {
        return this.$route.params.id
      },
      statusPublic() {
        return parseInt(this.product?.status) === 1
      },
      category() {
        return this.product?.category
      },
      currentCategories() {
        return this.product?.current_categories
      },
      productTitle() {
        return this.product?.title || ''
      },
      preparedSlug() {
        return this.categoryData?.map(i => {
          return { title: i.title, link: this.categoryLink(i) }
        })?.reverse()
      },
      categoryData(){
        return this.product?.category_data
      },
      productSlug() {
        return this.product?.slug
      },
      bundleDeal() {
        return this.product?.bundle_deal
      },
      isInStock() {
        return this.optionChange ? this.productInventory?.quantity > 0 : this.product.in_stock
      },
      inStock() {
        return this.isInStock ? this.$t('detail.inStock') : this.$t('detail.outOfStock')
      },
      vouchers() {
        return this.product?.vouchers;
      },
      brand() {
        return this.product?.brand?.title || ''
      },
      productAttributeImage() {

        const attrImg = []
          this.product.product_image_names.forEach((i, key) => {

          if(i.attributes.length) {
            attrImg[i.attributes[0]?.attribute_value_id] = {value: i, key: key}
          }
        });


        return attrImg;
      },
      productAttributes() {
        this.product?.attribute.forEach(i=>{
          this.clickedAttributes[i.id] = []
        })

        return this.product?.attribute.map(i => {
          return {
            ...i,
            ...{
              values: i.values.reduce((a, item) => {
                a[`${item.attribute_id}-${item.attribute_value_id}`] = item
                return a;
              }, {})
            }
          }
        })
      },
      ...mapGetters('common', ['currencyIcon', 'currencyPosition', 'setting']),
      ...mapGetters('detail', ['product']),
    },
    methods: {
      handleIntersection(entries) {
        entries.forEach((entry) => {

          if(entry.isIntersecting){
            document.body.classList.remove('show-cart')

          } else {
            document.body.classList.add('show-cart')
          }
        });
      },
      hasCartError(event){
        this.cartError = event
        this.$refs.attrRef.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center'});
      },

      selectedAttribute(data) {

        this.cartError.attribute = null
        //this.attrHover(data.value)

        this.currentAttributes[data.key.split('-')[0]] = data.value

        const imageMap = []
        this.product.product_image_names.map(i => {
          imageMap[i.attributes.map(j => {
            return j.attribute_value_id
          }).sort().join('-')] = i.image
        })

        const currentSelected = this.currentAttributes.map(i => { return i?.attribute_value_id })
          .filter(i => { return i })

        let bestMatch = null;
        let highestScore = -1;

        Object.keys(imageMap).forEach(key => {
          const splitKey = key.split('-').map(Number);
          const score = splitKey.reduce((acc, value) => acc + (currentSelected.includes(value) ? 1 : 0), 0);

          if (score > highestScore) {
            highestScore = score;
            bestMatch = imageMap[key];
          }
        });

        const selectedImage = highestScore > 0 ? bestMatch : null

        const imageIndex = this.productImageList?.findIndex(i => { return i.image === selectedImage})

        this.$refs.productImagesRef.zoomActiveChange(imageIndex > -1 ? imageIndex + 1 : 0)


        if (Object.values(this.currentAttributes).length === this.productAttributes.length) {

          const selected = Object.values(this.currentAttributes).map(i => {
            return i.attribute_value_id
          })

          const selectedAttr = selected.sort().join('-')

          let currentInventory = null
          const inventoryAttr = []


          for (var i of this.product?.inventory) {
            const invAttr = []
            i.inventory_attributes.forEach(j => {
              invAttr.push(parseInt(j.attribute_value_id))
            })

            inventoryAttr[invAttr.sort().join('-')] = i
          }

          if(inventoryAttr[selectedAttr]){
            currentInventory = inventoryAttr[selectedAttr]
          }

          this.selectedInventory = currentInventory
          this.optionChanged(currentInventory)
        } else {
          this.selectedInventory = {}
        }
      },
      descriptionToggle() {
        this.descriptionExpand = !this.descriptionExpand
      },
      closeVoucherPopOver() {
        this.voucherPopOver = false
      },
      fetchedReview(evt) {
        this.hasReview = !!evt
        this.reviewLoaded = !!!evt
      },
      optionChanged(evt) {
        this.optionChange = true
        this.productInventory = evt

      },
      qty(direction) {
        if (this.quantity + direction === 0) {
          return
        }
        this.quantity += direction
      },
      ...mapActions('common', ['fetchLocation']),
      ...mapActions('detail', ['emptySuggestedProducts']),
      ...mapActions('user', ['emptyVoucher']),
    },
    beforeDestroy() {
      document.body.classList.remove('detail-page')
    },
    async asyncData({store, route, $auth, error}) {
      try {
        await store.dispatch('detail/fetchProduct', {
          params: {
            id: route.params.id,
            user_id: $auth?.user?.id || ''
          },
          lang: store.state?.language?.langCode,
        })
      } catch (e) {
        error(e)
      }
    },
    async mounted() {
      this.emptyVoucher()
      this.emptySuggestedProducts()

      //Checking if the product has no attribute
      if (this.product?.inventory?.length === 1 && this.product?.inventory[0]?.inventory_attributes?.length === 0) {

        this.selectedInventory = this.product?.inventory[0]
      }

      document.body.classList.add('detail-page')

      this.observer = new IntersectionObserver(this.handleIntersection, {
        root: null, // Use the viewport as the root
        rootMargin: '0px', // No margin
        threshold: 0, // Trigger when 50% of the target is visible
      });

      // Start observing the target element
      this.observer.observe(this.$refs?.detailRight?.$el);
    }
  }
</script>

