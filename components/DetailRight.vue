<template>
  <div class="detail-right">
    <div class="sticky-right">
      <div class="content">
        <h2 class="price-wrapper mb-5">
          <span
            class="color-deep price"
          >
             <price-format
               :price="productPrice"
             />
          </span>
          <span
            class="strike-through f-7"
            v-if="prevPrice"
          >
            <price-format
              :price="prevPrice"
            />
          </span>
        </h2>
        <div>

          <span
            v-if="isFreeShipping"
            class="mr-5 block color-free"
          >
            {{ $t('invent.fs') }}
          </span>

          <span
            v-else
            class="mr-5 block"
          >
            + <price-format
            :price="parseInt(shippingPrice)"
          /> {{ $t('detailRight.shippingFee') }}
          </span>
          <div class="pos-rel lh-30 z-7 inline ">
            <button
              class="semi-bold clear-height mt-10"
              aria-label="submit"
              @click.prevent="pricePopOver = !pricePopOver"
              data-ignore="price-pop-over"
            >
              <span
                class="flex no-click"
              >
                <span class="mt-2">{{ $t('detailRight.details') }}</span>
                <i
                  class="icon black scale-8"
                  :class="[{'arrow-up': pricePopOver}, {'arrow-down': !pricePopOver}]"
                />
              </span>
            </button>
            <client-only>
              <pop-over
                v-if="pricePopOver"
                :title="$t('detailRight.shippingFeeDetails')"
                @close="closePricePopOver"
                :elem-id="'price-pop-over'"
                :layer="false"
              >
                <template v-slot:content>
                  <div class="flex sided">
                    <div>
                      <p>{{ $t('detailRight.price') }}</p>
                      <p>{{ $t('detailRight.shippingFee') }}</p>
                    </div>
                    <div class="right-text">
                      <p>
                        <price-format
                          :price="toFixed(productPrice)"
                        />
                      </p>
                      <p>

                        <span v-if="isFreeShipping" class="color-free">
                          {{ $t('invent.fre') }}
                        </span>
                        <price-format
                          v-else
                          :price="toFixed(shippingPrice)"
                        />
                      </p>
                    </div>
                  </div>
                </template>
                <template v-slot:pop-footer>
                  <div class="flex sided">
                    <h5 class="semi-bold">{{ $t('checkoutRight.total') }}</h5>
                    <h5 class="semi-bold">
                      <price-format
                        :price="toFixed(totalPrice)"
                      />
                    </h5>
                  </div>
                </template>
              </pop-over>
            </client-only>
          </div>
        </div>


        <div
          class="start flex gap-10 mb-10 wrap"
        >
          <span
            class="mt-5 mn-w-70x"
          >
            {{ $t('detailRight.quantity') }}
          </span>

          <quantity-nav
            class="mt-5"
            :quantity="quantity"
            :product-inventory="productInventory"
            :max="maxQuantity"
            @value-changed="quantity = $event.value"
          />

          <p
            v-if="cartError.inventory"
            class="error mb-10"
          >
            {{cartError.inventory}}
          </p>
        </div>
        <div class="flex-sm mlr-sm--2-5">
          <ajax-button
            id="add-to-cart"
            class="w-100 w-sm-50 primary-btn mtb-10 mlr-sm-2-5"
            :disabled="disabled"
            type="button"
            :fetching-data="ajaxing"
            @clicked="addToCart"
            :loading-text="$t('detailRight.adding')"
            :text="$t('detailRight.addToCart')"
          />
          <ajax-button
            class="w-100 w-sm-50 outline-btn  mtb-10 mlr-sm-2-5"
            :disabled="disabled"
            type="button"
            color="primary"
            :fetching-data="buyingNow"
            @clicked="addToCart(true)"
            :loading-text="$t('detailRight.buyNow')"
            :text="$t('detailRight.buyNow')"
          />
        </div>

        <div class="pos-rel inline">
          <button
            class="clear-height ml--7-5 mtb-10 f-10 semi-bold flex color-deep"
            aria-label="submit"
            @click.prevent="secureTrans = !secureTrans"
            data-ignore="secure-trans"
          >
            <i
              class="no-click icon lock-icon mr-5 opacity-35 dimen-20x"
            />
            {{ $t('detailRight.secureTransaction') }}
          </button>
          <pop-over
            :title="$t('detailRight.transactionIsSecured')"
            v-if="secureTrans"
            @close="closeSecureTrans"
            class="secure-trans"
            elem-id="secure-trans"
          >
            <template v-slot:content>
              <p class="mn-w-350x mn-w-sm-0">
                {{ $t('detailRight.secureTransaction') }}
                {{ $t('detailRight.secureTransactionMsg') }}
              </p>
            </template>
          </pop-over>
        </div>

        <client-only>
          <p class="f-9">
            {{ $t('detailRight.arrives') }} :
            <span class="color-lite semi-bold">
              {{arrivesAt}}
            </span>
          </p>
          <ajax-button
            class="mt-15 w-100 outline-btn hide-sm"
            type="button"
            color="primary"
            :fetching-data="ajaxingWishlist"
            @clicked="wishListAction"
            :loading-text="!wishListed ? $t('detailRight.addingToWishlist') : $t('detailRight.removingFromWishlist')"
            :text="!wishListed ? $t('detailRight.addToWishlist') : $t('detailRight.removeFromWishlist')"
          />
        </client-only>
      </div>

      <client-only>
        <social-share
          class="hide-sm mb-15"
          :product="product"
        />
      </client-only>

      <store-tile
        class="mt-10"
        :store="product.store"
      />

    </div><!-- detail-right -->
  </div><!-- detail-right -->
</template>

<script>
  import moment from 'moment'
  import util from '~/mixin/util'
  import cartHelper from '~/mixin/cartHelper'
  import productHelper from '~/mixin/productHelper'
  import productPriceHelper from '~/mixin/productPriceHelper'
  import Dropdown from '~/components/Dropdown'
  import PopOver from '~/components/PopOver'
  import SocialShare from '~/components/SocialShare'
  import QuantityNav from '~/components/QuantityNav'
  import AjaxButton from '~/components/AjaxButton'
  import {mapGetters, mapActions} from 'vuex'
  import PriceFormat from "~/components/PriceFormat"
  import StoreTile from "~/components/StoreTile"

  export default {
    data() {
      return {
        currentAttributes: [],
        inventory: null,
        price: 0,
        selectedAttributesTitle: {},
        pricePopOver: false,
        secureTrans: false
      }
    },
    props: {
      disabled: {
        type: Boolean,
        default: false
      },
      product: {
        type: Object
      },
      productInventory: {
        type: Object
      }
    },
    components: {
      StoreTile,
      PriceFormat,
      Dropdown,
      PopOver,
      SocialShare,
      QuantityNav,
      AjaxButton
    },
    mixins: [util, productHelper, productPriceHelper, cartHelper],
    computed: {
      totalPrice() {
        return parseFloat(this.productPrice) + parseFloat(this.shippingPrice)
      },
      shippingPlace() {
        const all = this.shippingRule.find(obj => {
          return obj.country.toUpperCase() === 'ALL'
        })
        if (!all) {
          let maxPrice = 0
          let maxObj = 0
          this.shippingRule.forEach((obj) => {
            if (parseFloat(obj.price) > maxPrice) {
              maxPrice = obj.price
              maxObj = obj
            }
          })
          return maxObj
        } else return all
      },
      arrivesAt() {
        const momentDate = moment()
          .add(this.shippingPlace?.day_needed, 'days')

        const day = momentDate.format('ddd').toLowerCase()
        const mon = momentDate.format('MMM').toLowerCase()
        const date = momentDate.format('D')
        return this.$t('date.ddddMMMD', {day: this.$t(`date.${day}`), mon: this.$t(`date.${mon}`), date: date})
      },
      isFreeShipping() {
        return !(parseFloat(this.shippingPrice) > 0)
      },
      shippingPrice() {
        return this.shippingPlace?.price || 0
      },
      shippingRule() {
        return this.product?.shipping_rule?.shipping_places;
      },
      ...mapGetters('cart', ['cartProducts']),
    },
    methods: {
      toFixed(num) {
        return parseFloat(num).toFixed(2)
      },
      closePricePopOver() {
        this.pricePopOver = false
      },
      closeSecureTrans() {
        this.secureTrans = false
      },
    },
    mounted() {
    },
  }
</script>

<style>

</style>
